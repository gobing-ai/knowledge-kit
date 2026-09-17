import { describe, expect, spyOn, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport } from '@gobing-ai/publish-harness';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import { getPublishTransport, MediumApiTransport, main, mapContentToMediumPost, processPublishIO } from '../src/index';

interface CapturedRequest {
    url: string;
    method: string;
    body: unknown;
}

function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
    const originals = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(env)) {
        originals.set(key, process.env[key]);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    return fn().finally(() => {
        for (const [key, value] of originals) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });
}

describe('medium-pub plugin', () => {
    test('mapContentToMediumPost defaults to draft and caps tags at 5', () => {
        const content: Content = {
            title: 'A Medium Post',
            body: '# A Medium Post\n\nHello.',
            format: 'markdown',
            metadata: { tags: ['a', 'b', 'c', 'd', 'e', 'f'] },
        };
        const body = mapContentToMediumPost(content);
        expect(body.title).toBe('A Medium Post');
        expect(body.publishStatus).toBe('draft');
        expect(body.tags).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(body.notifyFollowers).toBe(false);
    });

    test('mapContentToMediumPost honors confirmed live publishStatus', () => {
        const content: Content = { title: 'Live', body: 'Body.', format: 'markdown' };
        expect(mapContentToMediumPost(content, { publishStatus: 'public' }).publishStatus).toBe('public');
    });

    test('getPublishTransport resolves MediumApiTransport by default and fake when configured', () => {
        expect(getPublishTransport()).toBeInstanceOf(MediumApiTransport);
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(getPublishTransport()).toBeInstanceOf(FakeFileCliTransport);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }
    });

    test('MediumApiTransport fails loud when MEDIUM_INTEGRATION_TOKEN is unset', async () => {
        await withEnv({ MEDIUM_INTEGRATION_TOKEN: undefined }, async () => {
            const result = await new MediumApiTransport().publish({
                content: { title: 'No Token', body: 'Body.', format: 'markdown' },
            });
            expect(result.ok).toBe(false);
            expect(result.target).toBe('medium');
            expect(result.error).toContain('MEDIUM_INTEGRATION_TOKEN');
            expect(JSON.stringify(result)).not.toContain('secret-token-value');
        });
    });

    test('MediumApiTransport publishes via mocked fetch without live Medium I/O', async () => {
        const captured: CapturedRequest[] = [];
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
            input: Parameters<typeof fetch>[0],
            init?: Parameters<typeof fetch>[1],
        ): Promise<Response> => {
            captured.push({
                url: String(input),
                method: init?.method ?? 'GET',
                body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
            });
            if (String(input).endsWith('/me')) {
                return new Response(JSON.stringify({ data: { id: 'user-1', username: 'gobing' } }), { status: 200 });
            }
            return new Response(
                JSON.stringify({
                    data: {
                        id: 'post-1',
                        url: 'https://medium.com/@gobing/post-1',
                        publishStatus: 'draft',
                    },
                }),
                { status: 201 },
            );
        }) as typeof fetch);
        await withEnv({ MEDIUM_INTEGRATION_TOKEN: 'test-token' }, async () => {
            try {
                const result = await new MediumApiTransport().publish({
                    content: { title: 'My Post', body: 'Hello Medium.', format: 'markdown' },
                });
                expect(result.ok).toBe(true);
                expect(result.target).toBe('medium');
                expect(result.id).toBe('post-1');
                expect(result.url).toBe('https://medium.com/@gobing/post-1');
                expect(result.metadata?.publishStatus).toBe('draft');
                expect(captured[0]?.url).toBe('https://api.medium.com/v1/me');
                expect(captured[1]?.url).toBe('https://api.medium.com/v1/users/user-1/posts');
                expect(captured[1]?.method).toBe('POST');
                expect(captured[1]?.body).toMatchObject({ title: 'My Post', publishStatus: 'draft' });
                expect(JSON.stringify(result)).not.toContain('test-token');
            } finally {
                fetchSpy.mockRestore();
            }
        });
    });

    test('processPublishIO executes offline via FakeFileCliTransport', async () => {
        const fake = new FakeFileCliTransport();
        const tmpDir = join(process.cwd(), '.tmp-test-medium');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'Offline', body: 'Body.', format: 'markdown' }));
        try {
            await processPublishIO(inPath, outPath, fake);
            const result = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
            expect(result.ok).toBe(true);
            expect(fake.getCallLogs()).toHaveLength(1);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('main returns 1 when the token is missing and names the variable', async () => {
        const origArgv = process.argv;
        const tmpDir = join(process.cwd(), '.tmp-test-medium-main');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'Fail', body: 'Body.', format: 'markdown' }));
        const errTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: errTarget });
        await withEnv({ MEDIUM_INTEGRATION_TOKEN: undefined, KNOWLEDGE_KIT_PUBLISH_TRANSPORT: undefined }, async () => {
            process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];
            try {
                expect(await main()).toBe(1);
                expect(errTarget.text()).toContain('medium-pub failed');
                const result = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
                expect(result.ok).toBe(false);
                expect(result.error).toContain('MEDIUM_INTEGRATION_TOKEN');
            } finally {
                restore();
                process.argv = origArgv;
                await rm(tmpDir, { recursive: true, force: true });
            }
        });
    });

    test('invocable via runInvoke with medium-pub plugin discovery', async () => {
        const tmpDir = join(process.cwd(), '.tmp-test-medium-invoke');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'Invoke', body: 'Body.', format: 'markdown' }));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            const code = await runInvoke({
                plugin: 'medium-pub',
                inPath,
                outPath,
                pluginsRoot: join(process.cwd(), 'plugins'),
            });
            expect(code).toBe(0);
            expect(ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8'))).ok).toBe(true);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});
