import { describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import { FakeBrowserTransport } from '@gobing-ai/publish-harness';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import { getPublishTransport, main, processPublishIO, SubstackBrowserTransport } from '../src/index';

const content: Content = { title: 'Parity', body: 'Body.', format: 'markdown' };

describe('substack-pub plugin', () => {
    test('default driver is agent and kind is browser', () => {
        const transport = new SubstackBrowserTransport();
        expect(transport.kind).toBe('browser');
        expect(transport.driver).toBe('agent');
    });

    test('login timeout fails loud with profile dir', async () => {
        const result = await new SubstackBrowserTransport('agent', { sessionReady: false }).publish({ content });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('login timeout');
        expect(result.error).toContain(join(homedir(), '.config', 'kk', 'browser-profiles', 'substack'));
    });

    test('script and agent drivers share ok, target, and id for the same Content', async () => {
        const agent = await new SubstackBrowserTransport('agent', { sessionReady: true }).publish({ content });
        const script = await new SubstackBrowserTransport('script', { sessionReady: true }).publish({ content });
        expect(agent.ok).toBe(script.ok);
        expect(agent.target).toBe(script.target);
        expect(agent.id).toBe(script.id);
        expect(agent.target).toBe('substack');
        expect(agent.metadata?.publishStatus).toBe('draft');
    });

    test('FakeBrowserTransport offline processPublishIO', async () => {
        const fake = new FakeBrowserTransport('agent');
        const tmpDir = join(process.cwd(), '.tmp-test-substack');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify(content));
        try {
            await processPublishIO(inPath, outPath, fake);
            expect(ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8'))).ok).toBe(true);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('getPublishTransport fake switch', () => {
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(getPublishTransport()).toBeInstanceOf(FakeBrowserTransport);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }
    });

    test('main returns 1 without --in/--out and 0 on fake transport', async () => {
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

        const tmpDir = join(process.cwd(), '.tmp-test-substack-main');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify(content));
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
        const tmpDir = join(process.cwd(), '.tmp-test-substack-invoke');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify(content));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(
                await runInvoke({
                    plugin: 'substack-pub',
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
