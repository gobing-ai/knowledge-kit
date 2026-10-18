import { describe, expect, spyOn, test } from 'bun:test';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Content, type Result, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport, type PublishTransport, type PublishTransportPayload } from '@gobing-ai/publish-harness';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import {
    generateZennSlug,
    getPublishTransport,
    main,
    mapContentToZennMarkdown,
    processPublishIO,
    slugify,
    ZennCliFileCliTransport,
} from '../src/index';

/** Spy transport: records publish invocations offline; can be configured to reject. */
class SpyTransport implements PublishTransport {
    public readonly kind = 'file-cli';
    public publishCalls: PublishTransportPayload[] = [];
    public rejectWith?: string;

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        this.publishCalls.push(payload);
        if (this.rejectWith !== undefined) {
            return { ok: false, target: 'zenn', error: this.rejectWith };
        }
        return {
            ok: true,
            target: 'zenn',
            url: 'https://zenn.dev/articles/spy-article',
            id: 'spy-article',
            message: 'Spy transport published',
        };
    }
}

async function writeMockBin(dir: string, name: string, body: string): Promise<string> {
    await mkdir(dir, { recursive: true });
    const binPath = join(dir, name);
    await writeFile(binPath, `#!/usr/bin/env bun\n${body}\n`, 'utf-8');
    await Bun.spawn(['chmod', '+x', binPath]).exited;
    return binPath;
}

describe('zenn-pub plugin', () => {
    test('slugify converts tags into lowercase hyphenated strings', () => {
        expect(slugify('Web Dev')).toBe('web-dev');
        expect(slugify('  TypeScript & Bun  ')).toBe('typescript-bun');
    });

    test('generateZennSlug produces slugs meeting Zenn constraints', () => {
        const shortSlug = generateZennSlug('Hello World');
        expect(shortSlug).toMatch(/^[a-z0-9-_]{12,}$/);

        const longSlug = generateZennSlug('A very long article title about TypeScript and Bun and Zenn publishing!');
        expect(longSlug).toMatch(/^[a-z0-9-_]{12,}$/);
        expect(longSlug.length).toBeLessThanOrEqual(100);

        // All-punctuation titles collapse to an empty base; the generated slug
        // must still satisfy the 12-char minimum.
        const punctuationSlug = generateZennSlug('!!!');
        expect(punctuationSlug).toMatch(/^[a-z0-9-_]{12,}$/);
    });

    test('mapContentToZennMarkdown rejects an overlong metadata slug above the 100-char bound', () => {
        const content: Content = {
            title: 'Overlong Slug',
            body: '# Overlong Slug\n\nBody.',
            format: 'markdown',
            metadata: { slug: 'a'.repeat(101) },
        };
        expect(() => mapContentToZennMarkdown(content)).toThrow(/Invalid Zenn slug/);
    });

    test('mapContentToZennMarkdown maps Content properties per publish spec', () => {
        const content: Content = {
            title: 'My Zenn Article',
            body: '# My Zenn Article\n\nThis is the lead paragraph.\n\nSecond paragraph content.',
            format: 'markdown',
            references: [{ url: 'https://example.com/ref-1', title: 'Ref 1' }],
            metadata: {
                tags: ['Web Dev', 'TypeScript!'],
                published: true,
                type: 'tech',
                emoji: '🚀',
                slug: 'zenn-publish-channel-2026',
            },
        };

        const markdown = mapContentToZennMarkdown(content);
        expect(markdown).toContain('title: "My Zenn Article"');
        expect(markdown).toContain('type: "tech"');
        expect(markdown).toContain('emoji: "🚀"');
        expect(markdown).toContain('topics: ["web-dev", "typescript"]');
        expect(markdown).toContain('published: true');
        expect(markdown).toContain('slug: "zenn-publish-channel-2026"');
        expect(markdown).toContain('# My Zenn Article');
        expect(markdown.startsWith('---')).toBe(true);
    });

    test('mapContentToZennMarkdown extracts title and defaults when metadata is absent', () => {
        const content: Content = {
            body: '# Extracted Title\n\nLead paragraph text.',
            format: 'markdown',
        };

        const markdown = mapContentToZennMarkdown(content);
        expect(markdown).toContain('title: "Extracted Title"');
        expect(markdown).toContain('type: "tech"');
        expect(markdown).toContain('topics: []');
        expect(markdown).toContain('published: true');
    });

    test('getPublishTransport resolves ZennCliFileCliTransport by default and FakeFileCliTransport when configured', () => {
        expect(getPublishTransport()).toBeInstanceOf(ZennCliFileCliTransport);
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(getPublishTransport()).toBeInstanceOf(FakeFileCliTransport);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }
    });

    test('ZennCliFileCliTransport fails loud when ZENN_REPO is not configured', async () => {
        const origRepo = process.env.ZENN_REPO;
        delete process.env.ZENN_REPO;
        try {
            const transport = new ZennCliFileCliTransport();
            const content: Content = { title: 'No Repo Test', body: 'Test body', format: 'markdown' };
            const result = await transport.publish({ content });
            expect(result.ok).toBe(false);
            expect(result.target).toBe('zenn');
            expect(result.error).toContain('ZENN_REPO');
        } finally {
            if (origRepo !== undefined) process.env.ZENN_REPO = origRepo;
        }
    });

    test('ZennCliFileCliTransport publishes a draft article through a mocked npx CLI without external effects', async () => {
        const tmpDir = join(process.cwd(), '.works/tmp/test-zenn-cli-pass');
        await mkdir(tmpDir, { recursive: true });
        const binDir = join(tmpDir, 'bin');
        const repoDir = join(tmpDir, 'repo');
        await writeMockBin(binDir, 'npx', 'process.exit(0);');

        const origPath = process.env.PATH;
        const origRepo = process.env.ZENN_REPO;
        const origUser = process.env.ZENN_USERNAME;
        process.env.PATH = `${binDir}:${origPath ?? ''}`;
        process.env.ZENN_REPO = repoDir;
        // R10: the article URL needs the username segment (`/articles/<slug>` 404s).
        process.env.ZENN_USERNAME = 'alice';
        try {
            const transport = new ZennCliFileCliTransport();
            const content: Content = {
                title: 'Mocked Npx Draft Article',
                body: '# Mocked Npx Draft Article\n\nDraft body content.',
                format: 'markdown',
                metadata: { published: false },
            };

            const result = await transport.publish({ content });
            expect(result.ok).toBe(true);
            expect(result.target).toBe('zenn');
            expect(result.id).toBe(generateZennSlug(content.title ?? ''));
            expect(result.url).toBe(`https://zenn.dev/alice/articles/${generateZennSlug(content.title ?? '')}`);

            const articlePath = join(repoDir, 'articles', `${generateZennSlug(content.title ?? '')}.md`);
            const article = await readFile(articlePath, 'utf-8');
            expect(article).toContain('published: false');
            expect(article).toContain('# Mocked Npx Draft Article');
        } finally {
            if (origPath !== undefined) process.env.PATH = origPath;
            else delete process.env.PATH;
            if (origRepo !== undefined) process.env.ZENN_REPO = origRepo;
            else delete process.env.ZENN_REPO;
            if (origUser !== undefined) process.env.ZENN_USERNAME = origUser;
            else delete process.env.ZENN_USERNAME;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('ZennCliFileCliTransport fails loud when the Zenn CLI exits non-zero', async () => {
        const tmpDir = join(process.cwd(), '.works/tmp/test-zenn-cli-fail');
        await mkdir(tmpDir, { recursive: true });
        const binDir = join(tmpDir, 'bin');
        const repoDir = join(tmpDir, 'repo');
        await writeMockBin(binDir, 'npx', 'console.error("mock zenn cli failure"); process.exit(1);');

        const origPath = process.env.PATH;
        const origRepo = process.env.ZENN_REPO;
        process.env.PATH = `${binDir}:${origPath ?? ''}`;
        process.env.ZENN_REPO = repoDir;
        try {
            const transport = new ZennCliFileCliTransport();
            const content: Content = { title: 'Failing Cli Test', body: 'Test body', format: 'markdown' };

            const result = await transport.publish({ content });
            expect(result.ok).toBe(false);
            expect(result.target).toBe('zenn');
            expect(result.error).toContain('Zenn CLI failed (exit 1)');
            expect(result.error).toContain('mock zenn cli failure');
        } finally {
            if (origPath !== undefined) process.env.PATH = origPath;
            else delete process.env.PATH;
            if (origRepo !== undefined) process.env.ZENN_REPO = origRepo;
            else delete process.env.ZENN_REPO;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('ZennCliFileCliTransport resolves article fields once so the slug is stable across CLI, file write, and Result', async () => {
        const tmpDir = join(process.cwd(), '.works/tmp/test-zenn-slug-once');
        await mkdir(tmpDir, { recursive: true });
        const binDir = join(tmpDir, 'bin');
        const repoDir = join(tmpDir, 'repo');
        const slugPassedPath = join(tmpDir, 'slug-passed.txt');
        // Record the --slug argument the CLI receives so it can be compared with
        // the article file name and the Result id.
        await writeMockBin(
            binDir,
            'npx',
            `const args = process.argv.slice(2);\nconst i = args.indexOf('--slug');\nrequire('node:fs').writeFileSync(${JSON.stringify(slugPassedPath)}, args[i + 1] ?? '');\nprocess.exit(0);`,
        );

        const origPath = process.env.PATH;
        const origRepo = process.env.ZENN_REPO;
        const origUser = process.env.ZENN_USERNAME;
        process.env.PATH = `${binDir}:${origPath ?? ''}`;
        process.env.ZENN_REPO = repoDir;
        // R10: the article URL needs the username segment (`/articles/<slug>` 404s).
        process.env.ZENN_USERNAME = 'alice';
        // A short title (no metadata.slug) forces the Date.now() slug path; each
        // tick differs so a second resolution would re-roll the slug.
        let ticks = 0;
        const nowSpy = spyOn(Date, 'now').mockImplementation(() => 1_700_000_000_000 + ticks++);
        try {
            const transport = new ZennCliFileCliTransport();
            const content: Content = {
                title: 'Hi',
                body: '# Hi\n\nTiny body.',
                format: 'markdown',
                metadata: { published: false },
            };

            const result = await transport.publish({ content });
            expect(result.ok).toBe(true);

            const slugPassed = await readFile(slugPassedPath, 'utf-8');
            expect(result.id).toBe(slugPassed);
            expect(result.url).toBe(`https://zenn.dev/alice/articles/${slugPassed}`);

            const articlePath = join(repoDir, 'articles', `${slugPassed}.md`);
            const article = await readFile(articlePath, 'utf-8');
            expect(article).toContain(`slug: "${slugPassed}"`);

            // No stray template file: the CLI-created article is the one we wrote.
            const articleFiles = await readdir(join(repoDir, 'articles'));
            expect(articleFiles).toEqual([`${slugPassed}.md`]);
        } finally {
            nowSpy.mockRestore();
            if (origPath !== undefined) process.env.PATH = origPath;
            else delete process.env.PATH;
            if (origRepo !== undefined) process.env.ZENN_REPO = origRepo;
            else delete process.env.ZENN_REPO;
            if (origUser !== undefined) process.env.ZENN_USERNAME = origUser;
            else delete process.env.ZENN_USERNAME;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('processPublishIO executes offline via FakeFileCliTransport without external effects', async () => {
        const fakeTransport = new FakeFileCliTransport();
        const tmpDir = join(process.cwd(), '.works/tmp/test-zenn');
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
            target: 'zenn',
            error: 'Simulated Zenn CLI failure',
        });

        const tmpDir = join(process.cwd(), '.works/tmp/test-zenn-fail');
        await mkdir(tmpDir, { recursive: true });

        const inPath = join(tmpDir, 'input-content.json');
        const outPath = join(tmpDir, 'output-result.json');

        const inputContent: Content = {
            title: 'Test Fail',
            body: 'Body content for fail test.',
            format: 'markdown',
        };

        await writeFile(inPath, JSON.stringify(inputContent), 'utf-8');

        expect(processPublishIO(inPath, outPath, fakeTransport)).rejects.toThrow('Simulated Zenn CLI failure');

        const resultJson = JSON.parse(await readFile(outPath, 'utf-8'));
        const result = ResultSchema.parse(resultJson);

        expect(result.ok).toBe(false);
        expect(result.target).toBe('zenn');
        expect(result.error).toBe('Simulated Zenn CLI failure');

        await rm(tmpDir, { recursive: true, force: true });
    });

    test('processPublishIO writes error Result on validation failure', async () => {
        const tmpDir = join(process.cwd(), '.works/tmp/test-zenn-validate');
        await mkdir(tmpDir, { recursive: true });

        const inPath = join(tmpDir, 'input-content.json');
        const outPath = join(tmpDir, 'output-result.json');

        // Missing required `body` field violates ContentSchema.
        await writeFile(inPath, JSON.stringify({ title: 'No Body' }), 'utf-8');

        expect(processPublishIO(inPath, outPath, new FakeFileCliTransport())).rejects.toThrow('Invalid Content input');

        const resultJson = JSON.parse(await readFile(outPath, 'utf-8'));
        const result = ResultSchema.parse(resultJson);

        expect(result.ok).toBe(false);
        expect(result.target).toBe('zenn');
        expect(result.error).toContain('Invalid Content input');

        // Invalid JSON also lands in the validation-failure path.
        await writeFile(inPath, '{not valid json', 'utf-8');
        expect(processPublishIO(inPath, outPath, new FakeFileCliTransport())).rejects.toThrow('Invalid Content input');

        await rm(tmpDir, { recursive: true, force: true });
    });

    test('spy transport records invocations and propagates transport errors', async () => {
        const spyTransport = new SpyTransport();
        const tmpDir = join(process.cwd(), '.works/tmp/test-zenn-spy');
        await mkdir(tmpDir, { recursive: true });

        const inPath = join(tmpDir, 'input-content.json');
        const outPath = join(tmpDir, 'output-result.json');

        const inputContent: Content = {
            title: 'Spy Publish',
            body: 'Body content for spy test.',
            format: 'markdown',
        };
        await writeFile(inPath, JSON.stringify(inputContent), 'utf-8');

        await processPublishIO(inPath, outPath, spyTransport);

        expect(spyTransport.publishCalls.length).toBe(1);
        expect(spyTransport.publishCalls[0]?.content.title).toBe('Spy Publish');

        const successResult = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(successResult.ok).toBe(true);
        expect(successResult.target).toBe('zenn');

        spyTransport.rejectWith = 'Simulated transport rejection';
        expect(processPublishIO(inPath, outPath, spyTransport)).rejects.toThrow('Simulated transport rejection');

        const errorResult = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(errorResult.ok).toBe(false);
        expect(errorResult.target).toBe('zenn');
        expect(errorResult.error).toBe('Simulated transport rejection');

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

        const tmpDir = join(process.cwd(), '.works/tmp/test-zenn-main');
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

    test('invocable via runInvoke with zenn-pub plugin discovery', async () => {
        const tmpDir = join(process.cwd(), '.works/tmp/test-zenn-invoke');
        await mkdir(tmpDir, { recursive: true });

        const inPath = join(tmpDir, 'in-content.json');
        const outPath = join(tmpDir, 'out-result.json');

        const inputContent: Content = {
            title: 'Invoke Integration Test',
            body: 'Integration testing zenn-pub with runInvoke.',
            format: 'markdown',
        };

        await writeFile(inPath, JSON.stringify(inputContent), 'utf-8');

        const pluginsRoot = join(process.cwd(), 'plugins');
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            const code = await runInvoke({
                plugin: 'zenn-pub',
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

describe('Zenn CLI packaging, git scoping, and URL (R10)', () => {
    interface Harness {
        binDir: string;
        repoDir: string;
        logFile: string;
    }

    const CALL_LOG = (logFile: string): string =>
        `require('node:fs').appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ bin: process.argv[1].split('/').pop(), args: process.argv.slice(2) }) + '\\n');`;

    async function harness(dir: string, branch: string): Promise<Harness> {
        const binDir = join(dir, 'bin');
        const repoDir = join(dir, 'repo');
        const logFile = join(dir, 'calls.jsonl');
        await mkdir(repoDir, { recursive: true });
        await writeMockBin(binDir, 'npx', `${CALL_LOG(logFile)}\nprocess.exit(0);`);
        // `git` logs its argv and prints the branch as `rev-parse` output.
        await writeMockBin(
            binDir,
            'git',
            `${CALL_LOG(logFile)}\nconst a = process.argv.slice(2);\nif (a[0] === 'rev-parse') process.stdout.write(${JSON.stringify(branch)});\nprocess.exit(0);`,
        );
        return { binDir, repoDir, logFile };
    }

    async function calls(logFile: string): Promise<Array<{ bin: string; args: string[] }>> {
        const raw = await readFile(logFile, 'utf-8');
        return raw
            .split('\n')
            .filter((line) => line !== '')
            .map((line) => JSON.parse(line) as { bin: string; args: string[] });
    }

    /** Runs a publish against the mock bins, restoring PATH/ZENN_REPO/ZENN_USERNAME afterwards. */
    async function withHarness<T>(
        dir: string,
        branch: string,
        username: string | undefined,
        fn: (h: Harness) => Promise<T>,
    ): Promise<T> {
        const orig = { path: process.env.PATH, repo: process.env.ZENN_REPO, user: process.env.ZENN_USERNAME };
        const h = await harness(dir, branch);
        process.env.PATH = `${h.binDir}:${orig.path ?? ''}`;
        process.env.ZENN_REPO = h.repoDir;
        if (username === undefined) delete process.env.ZENN_USERNAME;
        else process.env.ZENN_USERNAME = username;
        try {
            return await fn(h);
        } finally {
            if (orig.path !== undefined) process.env.PATH = orig.path;
            else delete process.env.PATH;
            if (orig.repo !== undefined) process.env.ZENN_REPO = orig.repo;
            else delete process.env.ZENN_REPO;
            if (orig.user !== undefined) process.env.ZENN_USERNAME = orig.user;
            else delete process.env.ZENN_USERNAME;
        }
    }

    const publishedContent = (): Content => ({
        title: 'Published Article',
        body: '# Published Article\n\nBody.',
        format: 'markdown',
        metadata: { published: true },
    });

    async function withDir<T>(name: string, fn: (dir: string) => Promise<T>): Promise<T> {
        const dir = join(process.cwd(), name);
        await mkdir(dir, { recursive: true });
        try {
            return await fn(dir);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    }

    test('(a)(b)(d) pins the CLI package, scopes git to the article, pushes to main, and reports the URL', async () => {
        await withDir('.works/tmp/test-zenn-r10-main', async (dir) => {
            await withHarness(dir, 'main', 'alice', async (h) => {
                const result = await new ZennCliFileCliTransport().publish({ content: publishedContent() });
                expect(result.ok).toBe(true);
                expect(result.url).toBe(`https://zenn.dev/alice/articles/${result.id ?? ''}`);

                const recorded = await calls(h.logFile);
                const npx = recorded.find((c) => c.bin === 'npx');
                if (npx === undefined) throw new Error('npx was never invoked');
                // `npx <name>` would resolve the npm package literally named `zenn` (unpublished).
                expect(npx.args.slice(0, 5)).toEqual(['--yes', '--package', 'zenn-cli@0.5.4', 'zenn', 'new:article']);

                const gitArgs = recorded.filter((c) => c.bin === 'git').map((c) => c.args);
                expect(gitArgs).toContainEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
                expect(gitArgs).toContainEqual(['push', 'origin', 'main']);
                const articleRel = `articles/${result.id ?? ''}.md`;
                expect(gitArgs.find((args) => args[0] === 'add')).toEqual(['add', '--', articleRel]);
                const commit = gitArgs.find((args) => args[0] === 'commit');
                expect(commit).toBeDefined();
                expect(commit?.slice(-2)).toEqual(['--', articleRel]);
            });
        });
    });

    test('(c) a non-main branch fails loud before any commit or push', async () => {
        await withDir('.works/tmp/test-zenn-r10-branch', async (dir) => {
            await withHarness(dir, 'feature', 'alice', async (h) => {
                const result = await new ZennCliFileCliTransport().publish({ content: publishedContent() });
                expect(result.ok).toBe(false);
                expect(result.error).toContain('main');

                const gitArgs = (await calls(h.logFile)).filter((c) => c.bin === 'git').map((c) => c.args);
                expect(gitArgs.some((args) => args[0] === 'commit')).toBe(false);
                expect(gitArgs.some((args) => args[0] === 'push')).toBe(false);
            });
        });
    });

    test('(e) without ZENN_USERNAME the URL is omitted and the message names the env var', async () => {
        await withDir('.works/tmp/test-zenn-r10-nouser', async (dir) => {
            await withHarness(dir, 'main', undefined, async () => {
                const result = await new ZennCliFileCliTransport().publish({ content: publishedContent() });
                expect(result.ok).toBe(true);
                expect(result.url).toBeUndefined();
                expect(result.message).toContain('ZENN_USERNAME');
            });
        });
    });
});
