import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport } from '@gobing-ai/publish-harness';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import {
    getPublishTransport,
    main,
    mapContentToSurfingMarkdown,
    PostsurfingFileCliTransport,
    processPublishIO,
    slugify,
} from '../src/index';

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
            expect(result.message).toContain('Published successfully');
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
});
