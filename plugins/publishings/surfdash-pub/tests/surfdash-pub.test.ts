import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport } from '@gobing-ai/publish-harness';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import {
    awaitArticleLive,
    getPublishTransport,
    main,
    mapContentToSurfingMarkdown,
    normalizeLocaleFrontmatter,
    PostsurfingFileCliTransport,
    processPublishIO,
    pushPostGit,
    slugify,
    withEmdashTokenHint,
} from '../src/index';
import { localeIndexPath, patchPostFiles, upsertFrontmatterKey } from '../src/patch';

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
        expect(markdown).toContain('canonical: "https://example.com/ref-1"');
        expect(markdown).toContain('draft: false');
        expect(markdown).toContain('publishDate: "');
        expect(markdown).toContain('# My Surfing Article');
    });

    test('mapContentToSurfingMarkdown extracts title and lead paragraph when metadata is absent', () => {
        const content: Content = {
            body: '# Extracted Title\n\nThis lead paragraph will become the description.\n\nMore text.',
            format: 'markdown',
        };

        const markdown = mapContentToSurfingMarkdown(content);
        expect(markdown).toContain('title: "Extracted Title"');
        expect(markdown).toContain('description: "This lead paragraph will become the description."');
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
        await writeFile(mockBin, '#!/usr/bin/env bun\nconsole.log("Published"); process.exit(0);\n', 'utf-8');
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
        await writeFile(mockBin, '#!/usr/bin/env bun\nconsole.log("Published"); process.exit(0);\n', 'utf-8');
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
        const tmpDir = join(process.cwd(), '.tmp-test-surfdash');
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

        const tmpDir = join(process.cwd(), '.tmp-test-surfdash-fail');
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

        const tmpDir = join(process.cwd(), '.tmp-test-main');
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
        const tmpDir = join(process.cwd(), '.tmp-test-invoke');
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
        "import { appendFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        `const failExit = ${opts.syncExit ?? 0};`,
        'const argv = process.argv.slice(2);',
        'const [cmd, postPath] = argv;',
        "if (cmd !== 'sync' || !postPath) { console.error('usage: publish-orchestrator sync <postPath>'); process.exit(2); }",
        "if (failExit !== 0) { console.error('orchestrator sync exploded'); process.exit(failExit); }",
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
        expect(result.error).toContain('publish, scaffold-locale, sync');
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
        await writeFile(mockBin, '#!/usr/bin/env bun\nconsole.log("Published"); process.exit(0);\n', 'utf-8');
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
            const tmpDir = join(process.cwd(), '.tmp-test-surfdash-r7');
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
        await writeFile(bin, '#!/usr/bin/env bun\nconsole.log("Published"); process.exit(0);\n', 'utf-8');
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
        const tmpDir = join(process.cwd(), '.tmp-test-surfdash-r4-rundate');
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
        const tmpDir = join(process.cwd(), '.tmp-test-surfdash-r4-locale');
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
        const tmpDir = join(process.cwd(), '.tmp-test-surfdash-en-url');
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
        const tmpDir = join(process.cwd(), '.tmp-test-surfdash-r4-cover');
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

    test('patchPostFiles writes the cover URL and the cross-link for every published locale', async () => {
        await withTree(async (root, localCover) => {
            const outcome = patchPostFiles({
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
            expect(en).toContain('[listen to 每日AI乱炖 · 2026-10-11](https://pod.example/i/1)');

            // Idempotent: a second pass changes nothing and writes nothing.
            const again = patchPostFiles({
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

    test('patchPostFiles copies the local cover when no podcast cover URL exists', async () => {
        await withTree(async (root, localCover) => {
            // Strip the pre-existing `image:` so the fallback branch is reachable.
            for (const locale of ['zh', 'en']) {
                const md = await readFile(post(root, locale), 'utf-8');
                await writeFile(post(root, locale), md.replace(/^image:.*$/m, '').replace(/^og_image:.*$/m, ''));
            }
            const outcome = patchPostFiles({
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
});
