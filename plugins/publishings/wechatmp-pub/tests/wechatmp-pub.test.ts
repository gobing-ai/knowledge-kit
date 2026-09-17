import { describe, expect, spyOn, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport } from '@gobing-ai/publish-harness';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import {
    getPublishTransport,
    main,
    mapContentToWechatDraft,
    markdownToWechatHtml,
    processPublishIO,
    WechatDraftApiTransport,
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

describe('wechatmp-pub plugin', () => {
    test('markdownToWechatHtml maps headings, paragraphs, and code', () => {
        const html = markdownToWechatHtml('# Title\n\nHello **world**.\n\n```\nconst x = 1;\n```');
        expect(html).toContain('<h1>Title</h1>');
        expect(html).toContain('<strong>world</strong>');
        expect(html).toContain('<pre><code>');
        expect(html).toContain('const x = 1;');
    });

    test('mapContentToWechatDraft requires thumbMediaId and truncates title', () => {
        expect(() => mapContentToWechatDraft({ title: 'T', body: 'B', format: 'markdown' })).toThrow(/thumbMediaId/);
        const draft = mapContentToWechatDraft({
            title: 'A'.repeat(40),
            body: 'Lead paragraph.\n\nMore.',
            format: 'markdown',
            metadata: { thumbMediaId: 'thumb-1' },
        });
        expect(draft.articles[0]?.title).toHaveLength(32);
        expect(draft.articles[0]?.thumb_media_id).toBe('thumb-1');
        expect(draft.articles[0]?.digest).toContain('Lead paragraph');
    });

    test('live publish fails loud and asks for operator confirmation', async () => {
        const result = await new WechatDraftApiTransport().publish({
            content: { title: 'Live', body: 'Body.', format: 'markdown', metadata: { thumbMediaId: 't' } },
            options: { operation: 'live' },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('certification-gated');
        expect(result.error).toContain('operator');
    });

    test('missing AppID/AppSecret names the variables and does not leak secrets', async () => {
        await withEnv({ WECHAT_APP_ID: undefined, WECHAT_APP_SECRET: 'super-secret' }, async () => {
            const result = await new WechatDraftApiTransport().publish({
                content: { title: 'T', body: 'B', format: 'markdown', metadata: { thumbMediaId: 't' } },
            });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('WECHAT_APP_ID');
            expect(JSON.stringify(result)).not.toContain('super-secret');
        });
    });

    test('draft/add via mocked fetch returns media_id', async () => {
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
            input: Parameters<typeof fetch>[0],
        ): Promise<Response> => {
            const url = String(input);
            if (url.includes('/cgi-bin/token')) {
                return new Response(JSON.stringify({ access_token: 'tok', expires_in: 7200 }), { status: 200 });
            }
            return new Response(JSON.stringify({ media_id: 'draft-media-1' }), { status: 200 });
        }) as typeof fetch);
        await withEnv({ WECHAT_APP_ID: 'wxid', WECHAT_APP_SECRET: 'secret' }, async () => {
            try {
                const result = await new WechatDraftApiTransport().publish({
                    content: { title: 'Draft', body: 'Body.', format: 'markdown', metadata: { thumbMediaId: 'thumb' } },
                });
                expect(result.ok).toBe(true);
                expect(result.id).toBe('draft-media-1');
                expect(result.metadata?.publishStatus).toBe('draft');
                expect(JSON.stringify(result)).not.toContain('secret');
            } finally {
                fetchSpy.mockRestore();
            }
        });
    });

    test('processPublishIO uses FakeFileCliTransport offline', async () => {
        const fake = new FakeFileCliTransport();
        const tmpDir = join(process.cwd(), '.tmp-test-wechat');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(
            inPath,
            JSON.stringify({ title: 'T', body: 'B', format: 'markdown', metadata: { thumbMediaId: 't' } }),
        );
        try {
            await processPublishIO(inPath, outPath, fake);
            expect(ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8'))).ok).toBe(true);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('getPublishTransport fake switch', () => {
        expect(getPublishTransport()).toBeInstanceOf(WechatDraftApiTransport);
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(getPublishTransport()).toBeInstanceOf(FakeFileCliTransport);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }
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
        const tmpDir = join(process.cwd(), '.tmp-test-wechat-main');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'B', format: 'markdown' }));
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
        const tmpDir = join(process.cwd(), '.tmp-test-wechat-invoke');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'B', format: 'markdown' }));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            const code = await runInvoke({
                plugin: 'wechatmp-pub',
                inPath,
                outPath,
                pluginsRoot: join(process.cwd(), 'plugins'),
            });
            expect(code).toBe(0);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});
