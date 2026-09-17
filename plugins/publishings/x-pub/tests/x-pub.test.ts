import { describe, expect, spyOn, test } from 'bun:test';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ResultSchema } from '@gobing-ai/kk-core';
import { FakeBrowserTransport, FakeFileCliTransport } from '@gobing-ai/publish-harness';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import {
    getPublishTransport,
    main,
    oauth1Header,
    processPublishIO,
    XArticleBrowserTransport,
    XPostApiTransport,
} from '../src/index';

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

const TOKENS = {
    X_API_KEY: 'key',
    X_API_SECRET: 'secret',
    X_ACCESS_TOKEN: 'token',
    X_ACCESS_TOKEN_SECRET: 'token-secret',
};

describe('x-pub plugin', () => {
    test('oauth1Header is deterministic for fixed nonce and timestamp', () => {
        const header = oauth1Header({
            method: 'POST',
            url: 'https://api.twitter.com/2/tweets',
            consumerKey: 'key',
            consumerSecret: 'secret',
            token: 'token',
            tokenSecret: 'token-secret',
            nonce: 'nonce',
            timestamp: '1',
        });
        expect(header.startsWith('OAuth ')).toBe(true);
        expect(header).toContain('oauth_signature=');
        expect(header).toContain('oauth_consumer_key="key"');
    });

    test('post fails loud when developer tokens are unset and does not drive x.com', async () => {
        await withEnv(
            {
                X_API_KEY: undefined,
                X_API_SECRET: undefined,
                X_ACCESS_TOKEN: undefined,
                X_ACCESS_TOKEN_SECRET: undefined,
            },
            async () => {
                const result = await new XPostApiTransport().publish({
                    content: { title: 'Hi', body: 'Hello X', format: 'markdown' },
                });
                expect(result.ok).toBe(false);
                expect(result.error).toContain('X_API_KEY');
                expect(result.error).toContain('does not fall back to a browser');
            },
        );
    });

    test('post calls POST /2/tweets via mocked fetch', async () => {
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
            input: Parameters<typeof fetch>[0],
            init?: Parameters<typeof fetch>[1],
        ): Promise<Response> => {
            expect(String(input)).toBe('https://api.twitter.com/2/tweets');
            expect(init?.method).toBe('POST');
            expect(String(init?.headers && new Headers(init.headers).get('Authorization'))).toMatch(/^OAuth /);
            return new Response(JSON.stringify({ data: { id: '123', text: 'Hello X' } }), { status: 201 });
        }) as typeof fetch);
        await withEnv(TOKENS, async () => {
            try {
                const result = await new XPostApiTransport().publish({
                    content: { body: 'Hello X', format: 'markdown' },
                });
                expect(result.ok).toBe(true);
                expect(result.id).toBe('123');
                expect(result.url).toContain('123');
                expect(JSON.stringify(result)).not.toContain('token-secret');
            } finally {
                fetchSpy.mockRestore();
            }
        });
    });

    test('article transport is browser/agent and login timeout fails loud', async () => {
        const timedOut = new XArticleBrowserTransport('agent', { loginTimeoutMs: 0, sessionReady: false });
        expect(timedOut.kind).toBe('browser');
        expect(timedOut.driver).toBe('agent');
        const failResult = await timedOut.publish({ content: { title: 'Long', body: 'Body', format: 'markdown' } });
        expect(failResult.ok).toBe(false);
        expect(failResult.error).toContain('login timeout');
        expect(failResult.error).toContain(join(homedir(), '.config', 'kk', 'browser-profiles', 'x'));

        const ready = new XArticleBrowserTransport('agent', { sessionReady: true });
        const ok = await ready.publish({ content: { title: 'Long', body: 'Body', format: 'markdown' } });
        expect(ok.ok).toBe(true);
        expect(ok.metadata?.operation).toBe('article');
        expect(ok.metadata?.publishStatus).toBe('draft');
    });

    test('fake transports: post uses FakeFileCliTransport, article uses FakeBrowserTransport', () => {
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(getPublishTransport('post')).toBeInstanceOf(FakeFileCliTransport);
            expect(getPublishTransport('article')).toBeInstanceOf(FakeBrowserTransport);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }
    });

    test('processPublishIO article operation stays offline on FakeBrowserTransport', async () => {
        const fake = new FakeBrowserTransport('agent');
        const tmpDir = join(process.cwd(), '.tmp-test-x-article');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(
            inPath,
            JSON.stringify({ title: 'A', body: 'B', format: 'markdown', options: { operation: 'article' } }),
        );
        try {
            await processPublishIO(inPath, outPath, fake);
            expect(ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8'))).ok).toBe(true);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('no second X plugin package exists', async () => {
        const names = await readdir(join(process.cwd(), 'plugins/publishings'));
        const xish = names.filter(
            (name) => /^x(-|$)/.test(name) || name.includes('twitter') || name === 'publish-to-x',
        );
        expect(xish).toEqual(['x-pub']);
    });

    test('main returns 1 without args and 0 on fake transport', async () => {
        const origArgv = process.argv;
        const errTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: errTarget });
        process.argv = ['bun', 'index.ts'];
        try {
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('Missing required arguments');
        } finally {
            restore();
            process.argv = origArgv;
        }
        const tmpDir = join(process.cwd(), '.tmp-test-x-main');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'Hello', format: 'markdown' }));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];
        try {
            expect(await main()).toBe(0);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            process.argv = origArgv;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('invocable via runInvoke', async () => {
        const tmpDir = join(process.cwd(), '.tmp-test-x-invoke');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'Hello', format: 'markdown' }));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(
                await runInvoke({
                    plugin: 'x-pub',
                    inPath,
                    outPath,
                    pluginsRoot: join(process.cwd(), 'plugins'),
                }),
            ).toBe(0);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});
