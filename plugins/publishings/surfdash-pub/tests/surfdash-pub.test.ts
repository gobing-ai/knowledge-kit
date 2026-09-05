import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
