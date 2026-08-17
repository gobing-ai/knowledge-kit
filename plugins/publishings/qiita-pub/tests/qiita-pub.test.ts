import { describe, expect, spyOn, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Content, type Result, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport, type PublishTransport, type PublishTransportPayload } from '@gobing-ai/publish-harness';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import {
    getPublishTransport,
    main,
    mapContentToQiitaMarkdown,
    processPublishIO,
    QiitaApiTransport,
    slugify,
} from '../src/index';

/** Captured Qiita API request for offline assertions. */
interface CapturedRequest {
    url: string;
    method: string;
    headers: Headers;
    body: unknown;
}

/** Spy transport: records publish invocations offline; can be configured to reject. */
class SpyTransport implements PublishTransport {
    public readonly kind = 'file-cli';
    public publishCalls: PublishTransportPayload[] = [];
    public rejectWith?: string;

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        this.publishCalls.push(payload);
        if (this.rejectWith !== undefined) {
            return { ok: false, target: 'qiita', error: this.rejectWith };
        }
        return {
            ok: true,
            target: 'qiita',
            url: 'https://qiita.com/user/items/spy-article',
            id: 'spy-article',
            message: 'Spy transport published',
        };
    }
}

describe('qiita-pub plugin', () => {
    test('slugify converts tags into lowercase hyphenated strings', () => {
        expect(slugify('Web Dev')).toBe('web-dev');
        expect(slugify('  TypeScript & Bun  ')).toBe('typescript-bun');
    });

    test('mapContentToQiitaMarkdown maps Content properties per publish spec', () => {
        const content: Content = {
            title: 'My Qiita Article',
            body: '# My Qiita Article\n\nThis is the lead paragraph.\n\nSecond paragraph content.',
            format: 'markdown',
            metadata: {
                tags: ['Web Dev', 'TypeScript!'],
                private: false,
            },
        };

        const markdown = mapContentToQiitaMarkdown(content);
        expect(markdown.startsWith('---')).toBe(true);
        expect(markdown).toContain('title: "My Qiita Article"');
        expect(markdown).toContain('tags:');
        expect(markdown).toContain('  - "web-dev"');
        expect(markdown).toContain('  - "typescript"');
        expect(markdown).toContain('private: false');
        expect(markdown).toContain('# My Qiita Article');
    });

    test('mapContentToQiitaMarkdown extracts title and defaults when metadata is absent', () => {
        const content: Content = {
            body: '# Extracted Title\n\nLead paragraph text.',
            format: 'markdown',
        };

        const markdown = mapContentToQiitaMarkdown(content);
        expect(markdown).toContain('title: "Extracted Title"');
        expect(markdown).toContain('tags:');
        expect(markdown).toContain('  []');
        expect(markdown).toContain('private: false');
    });

    test('mapContentToQiitaMarkdown honors the private flag and the shared published flag', () => {
        const privateContent: Content = {
            title: 'Limited Sharing',
            body: 'Body.',
            format: 'markdown',
            metadata: { private: true },
        };
        expect(mapContentToQiitaMarkdown(privateContent)).toContain('private: true');

        const unpublishedContent: Content = {
            title: 'Draft',
            body: 'Body.',
            format: 'markdown',
            metadata: { published: false },
        };
        expect(mapContentToQiitaMarkdown(unpublishedContent)).toContain('private: true');
    });

    test('mapContentToQiitaMarkdown rejects tags that cannot be slugified', () => {
        const content: Content = {
            title: 'Bad Tag',
            body: 'Body.',
            format: 'markdown',
            metadata: { tags: ['日本語', 'web-dev'] },
        };
        expect(() => mapContentToQiitaMarkdown(content)).toThrow(/Invalid tag "日本語"/);
    });

    test('getPublishTransport resolves QiitaApiTransport by default and FakeFileCliTransport when configured', () => {
        expect(getPublishTransport()).toBeInstanceOf(QiitaApiTransport);
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(getPublishTransport()).toBeInstanceOf(FakeFileCliTransport);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }
    });

    test('QiitaApiTransport fails loud when QIITA_TOKEN is not configured', async () => {
        const origToken = process.env.QIITA_TOKEN;
        delete process.env.QIITA_TOKEN;
        try {
            const transport = new QiitaApiTransport();
            const content: Content = { title: 'No Token Test', body: 'Test body', format: 'markdown' };
            const result = await transport.publish({ content });
            expect(result.ok).toBe(false);
            expect(result.target).toBe('qiita');
            expect(result.error).toContain('QIITA_TOKEN');
        } finally {
            if (origToken !== undefined) process.env.QIITA_TOKEN = origToken;
        }
    });

    test('QiitaApiTransport publishes via a mocked fetch without external effects', async () => {
        const origToken = process.env.QIITA_TOKEN;
        process.env.QIITA_TOKEN = 'test-token';
        let captured: CapturedRequest | undefined;
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
            input: Parameters<typeof fetch>[0],
            init?: Parameters<typeof fetch>[1],
        ): Promise<Response> => {
            captured = {
                url: String(input),
                method: init?.method ?? 'GET',
                headers: new Headers(init?.headers),
                body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
            };
            return new Response(
                JSON.stringify({
                    id: 'c686397e4a0f4f11683d',
                    url: 'https://qiita.com/gobing/items/c686397e4a0f4f11683d',
                    title: 'My Qiita Article',
                    private: false,
                    tags: [{ name: 'web-dev' }],
                }),
                { status: 201 },
            );
        }) as typeof fetch);
        try {
            const transport = new QiitaApiTransport();
            const content: Content = {
                title: 'My Qiita Article',
                body: '# My Qiita Article\n\nBody content.',
                format: 'markdown',
                metadata: { tags: ['Web Dev'] },
            };

            const result = await transport.publish({ content });
            expect(result.ok).toBe(true);
            expect(result.target).toBe('qiita');
            expect(result.id).toBe('c686397e4a0f4f11683d');
            expect(result.url).toBe('https://qiita.com/gobing/items/c686397e4a0f4f11683d');
            expect(result.message).toContain('Published successfully');

            expect(captured?.url).toBe('https://qiita.com/api/v2/items');
            expect(captured?.method).toBe('POST');
            expect(captured?.headers.get('Authorization')).toBe('Bearer test-token');
            expect(captured?.headers.get('Content-Type')).toBe('application/json');
            expect(captured?.body).toEqual({
                title: 'My Qiita Article',
                body: '# My Qiita Article\n\nBody content.',
                tags: [{ name: 'web-dev' }],
                private: false,
            });
        } finally {
            fetchSpy.mockRestore();
            if (origToken !== undefined) process.env.QIITA_TOKEN = origToken;
            else delete process.env.QIITA_TOKEN;
        }
    });

    test('QiitaApiTransport fails loud when the API rejects the request', async () => {
        const origToken = process.env.QIITA_TOKEN;
        process.env.QIITA_TOKEN = 'test-token';
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
            (async (): Promise<Response> =>
                new Response('{"type":"error","message":"Forbidden"}', {
                    status: 403,
                    statusText: 'Forbidden',
                })) as unknown as typeof fetch,
        );
        try {
            const transport = new QiitaApiTransport();
            const content: Content = { title: 'Rejected Article', body: 'Body.', format: 'markdown' };

            const result = await transport.publish({ content });
            expect(result.ok).toBe(false);
            expect(result.target).toBe('qiita');
            expect(result.error).toContain('HTTP 403');
            expect(result.error).toContain('Forbidden');
        } finally {
            fetchSpy.mockRestore();
            if (origToken !== undefined) process.env.QIITA_TOKEN = origToken;
            else delete process.env.QIITA_TOKEN;
        }
    });

    test('QiitaApiTransport deduplicates tags after slugification', async () => {
        const origToken = process.env.QIITA_TOKEN;
        process.env.QIITA_TOKEN = 'test-token';
        let capturedBody: unknown;
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
            _input: Parameters<typeof fetch>[0],
            init?: Parameters<typeof fetch>[1],
        ): Promise<Response> => {
            capturedBody = init?.body === undefined ? undefined : JSON.parse(String(init.body));
            return new Response(JSON.stringify({ id: 'dup-1', url: 'https://qiita.com/user/items/dup-1' }), {
                status: 201,
            });
        }) as typeof fetch);
        try {
            const transport = new QiitaApiTransport();
            const content: Content = {
                title: 'Dup Tags',
                body: 'Body.',
                format: 'markdown',
                metadata: { tags: ['Web Dev', 'web-dev', 'Web Dev'] },
            };

            const result = await transport.publish({ content });
            expect(result.ok).toBe(true);
            expect((capturedBody as { tags: Array<{ name: string }> }).tags).toEqual([{ name: 'web-dev' }]);
        } finally {
            fetchSpy.mockRestore();
            if (origToken !== undefined) process.env.QIITA_TOKEN = origToken;
            else delete process.env.QIITA_TOKEN;
        }
    });

    test('QiitaApiTransport fails loud when fetch rejects (network error)', async () => {
        const origToken = process.env.QIITA_TOKEN;
        process.env.QIITA_TOKEN = 'test-token';
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (): Promise<Response> => {
            throw new Error('network down');
        }) as unknown as typeof fetch);
        try {
            const transport = new QiitaApiTransport();
            const content: Content = { title: 'Network Failure', body: 'Body.', format: 'markdown' };

            const result = await transport.publish({ content });
            expect(result.ok).toBe(false);
            expect(result.target).toBe('qiita');
            expect(result.error).toContain('network down');
        } finally {
            fetchSpy.mockRestore();
            if (origToken !== undefined) process.env.QIITA_TOKEN = origToken;
            else delete process.env.QIITA_TOKEN;
        }
    });

    test('QiitaApiTransport returns an error Result for unmappable tags without calling fetch', async () => {
        const origToken = process.env.QIITA_TOKEN;
        process.env.QIITA_TOKEN = 'test-token';
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (): Promise<Response> => {
            throw new Error('fetch must not be called for unmappable tags');
        }) as unknown as typeof fetch);
        try {
            const transport = new QiitaApiTransport();
            const content: Content = {
                title: 'Bad Tag',
                body: 'Body.',
                format: 'markdown',
                metadata: { tags: ['日本語'] },
            };

            const result = await transport.publish({ content });
            expect(result.ok).toBe(false);
            expect(result.target).toBe('qiita');
            expect(result.error).toContain('Invalid tag');
        } finally {
            fetchSpy.mockRestore();
            if (origToken !== undefined) process.env.QIITA_TOKEN = origToken;
            else delete process.env.QIITA_TOKEN;
        }
    });

    test('processPublishIO executes offline via FakeFileCliTransport without external effects', async () => {
        const fakeTransport = new FakeFileCliTransport();
        const tmpDir = join(process.cwd(), '.tmp-test-qiita');
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
            target: 'qiita',
            error: 'Simulated Qiita API failure',
        });

        const tmpDir = join(process.cwd(), '.tmp-test-qiita-fail');
        await mkdir(tmpDir, { recursive: true });

        const inPath = join(tmpDir, 'input-content.json');
        const outPath = join(tmpDir, 'output-result.json');

        const inputContent: Content = {
            title: 'Test Fail',
            body: 'Body content for fail test.',
            format: 'markdown',
        };

        await writeFile(inPath, JSON.stringify(inputContent), 'utf-8');

        expect(processPublishIO(inPath, outPath, fakeTransport)).rejects.toThrow('Simulated Qiita API failure');

        const resultJson = JSON.parse(await readFile(outPath, 'utf-8'));
        const result = ResultSchema.parse(resultJson);

        expect(result.ok).toBe(false);
        expect(result.target).toBe('qiita');
        expect(result.error).toBe('Simulated Qiita API failure');

        await rm(tmpDir, { recursive: true, force: true });
    });

    test('processPublishIO writes error Result on validation failure', async () => {
        const tmpDir = join(process.cwd(), '.tmp-test-qiita-validate');
        await mkdir(tmpDir, { recursive: true });

        const inPath = join(tmpDir, 'input-content.json');
        const outPath = join(tmpDir, 'output-result.json');

        // Missing required `body` field violates ContentSchema.
        await writeFile(inPath, JSON.stringify({ title: 'No Body' }), 'utf-8');

        expect(processPublishIO(inPath, outPath, new FakeFileCliTransport())).rejects.toThrow('Invalid Content input');

        const resultJson = JSON.parse(await readFile(outPath, 'utf-8'));
        const result = ResultSchema.parse(resultJson);

        expect(result.ok).toBe(false);
        expect(result.target).toBe('qiita');
        expect(result.error).toContain('Invalid Content input');

        // Invalid JSON also lands in the validation-failure path.
        await writeFile(inPath, '{not valid json', 'utf-8');
        expect(processPublishIO(inPath, outPath, new FakeFileCliTransport())).rejects.toThrow('Invalid Content input');

        await rm(tmpDir, { recursive: true, force: true });
    });

    test('spy transport records invocations and propagates transport errors', async () => {
        const spyTransport = new SpyTransport();
        const tmpDir = join(process.cwd(), '.tmp-test-qiita-spy');
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
        expect(successResult.target).toBe('qiita');

        spyTransport.rejectWith = 'Simulated transport rejection';
        expect(processPublishIO(inPath, outPath, spyTransport)).rejects.toThrow('Simulated transport rejection');

        const errorResult = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(errorResult.ok).toBe(false);
        expect(errorResult.target).toBe('qiita');
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

        const tmpDir = join(process.cwd(), '.tmp-test-qiita-main');
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

    test('main returns 1 on invalid arguments instead of throwing', async () => {
        const origArgv = process.argv;
        process.argv = ['bun', 'index.ts', '--bogus'];
        const errTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: errTarget });
        try {
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('Invalid arguments');
        } finally {
            restore();
            process.argv = origArgv;
        }
    });

    test('main returns 1 when publish fails and writes the error Result', async () => {
        const origArgv = process.argv;
        const origToken = process.env.QIITA_TOKEN;
        delete process.env.QIITA_TOKEN;
        delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        const errTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: errTarget });

        const tmpDir = join(process.cwd(), '.tmp-test-qiita-main-fail');
        await mkdir(tmpDir, { recursive: true });

        const inPath = join(tmpDir, 'in-content.json');
        const outPath = join(tmpDir, 'out-result.json');

        await writeFile(
            inPath,
            JSON.stringify({ title: 'Failing Publish', body: 'Body.', format: 'markdown' }),
            'utf-8',
        );

        process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];
        try {
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('qiita-pub failed');

            const resultJson = JSON.parse(await readFile(outPath, 'utf-8'));
            expect(ResultSchema.parse(resultJson).ok).toBe(false);
        } finally {
            restore();
            process.argv = origArgv;
            if (origToken !== undefined) process.env.QIITA_TOKEN = origToken;
            else delete process.env.QIITA_TOKEN;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('invocable via runInvoke with qiita-pub plugin discovery', async () => {
        const tmpDir = join(process.cwd(), '.tmp-test-qiita-invoke');
        await mkdir(tmpDir, { recursive: true });

        const inPath = join(tmpDir, 'in-content.json');
        const outPath = join(tmpDir, 'out-result.json');

        const inputContent: Content = {
            title: 'Invoke Integration Test',
            body: 'Integration testing qiita-pub with runInvoke.',
            format: 'markdown',
        };

        await writeFile(inPath, JSON.stringify(inputContent), 'utf-8');

        const pluginsRoot = join(process.cwd(), 'plugins');
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            const code = await runInvoke({
                plugin: 'qiita-pub',
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
