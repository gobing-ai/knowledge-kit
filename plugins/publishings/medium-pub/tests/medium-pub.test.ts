import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport } from '@gobing-ai/publish-harness';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import { channelConfig, isAuthenticated } from '../src/browser-rail';
import {
    getPublishTransport,
    MediumApiTransport,
    MediumBrowserTransport,
    main,
    mapContentToMediumPost,
    processPublishIO,
} from '../src/index';
import { main as profileCheckMain } from '../src/profile-check';

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

    test('getPublishTransport resolves MediumApiTransport with token, MediumBrowserTransport without token, and fake when configured', async () => {
        await withEnv({ MEDIUM_INTEGRATION_TOKEN: 'tok', KNOWLEDGE_KIT_PUBLISH_TRANSPORT: undefined }, async () => {
            expect(getPublishTransport()).toBeInstanceOf(MediumApiTransport);
        });
        await withEnv({ MEDIUM_INTEGRATION_TOKEN: undefined, KNOWLEDGE_KIT_PUBLISH_TRANSPORT: undefined }, async () => {
            expect(getPublishTransport()).toBeInstanceOf(MediumBrowserTransport);
        });
        await withEnv({ KNOWLEDGE_KIT_PUBLISH_TRANSPORT: 'fake' }, async () => {
            expect(getPublishTransport()).toBeInstanceOf(FakeFileCliTransport);
        });
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
        const tmpDir = join(process.cwd(), '.works/tmp/test-medium');
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

    test('main returns 1 when the token and browser profile are missing and names recovery options', async () => {
        const origArgv = process.argv;
        const tmpDir = join(process.cwd(), '.works/tmp/test-medium-main');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        const missingProfile = join(tmpDir, 'no-medium-profile');
        await writeFile(inPath, JSON.stringify({ title: 'Fail', body: 'Body.', format: 'markdown' }));
        const errTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: errTarget });
        await withEnv(
            {
                MEDIUM_INTEGRATION_TOKEN: undefined,
                KNOWLEDGE_KIT_PUBLISH_TRANSPORT: undefined,
                MEDIUM_PROFILE_DIR: missingProfile,
            },
            async () => {
                process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];
                try {
                    expect(await main()).toBe(1);
                    expect(errTarget.text()).toContain('medium-pub failed');
                    const result = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
                    expect(result.ok).toBe(false);
                    expect(result.error).toContain('MEDIUM_INTEGRATION_TOKEN');
                    expect(result.error).toContain('kk bot login medium');
                } finally {
                    restore();
                    process.argv = origArgv;
                    await rm(tmpDir, { recursive: true, force: true });
                }
            },
        );
    });

    test('the rail is headed-only and fails closed on a Cloudflare challenge (0423 R4)', async () => {
        const tmpDir = join(process.cwd(), '.works/tmp/test-medium-challenge');
        await mkdir(tmpDir, { recursive: true });
        const launches: Array<{ headless?: boolean }> = [];
        const pageFor = (title: string) => ({
            url: () => 'https://medium.com/new-story',
            title: async () => title,
            goto: async () => undefined,
            locator: () => ({
                first: () => ({ count: async () => 1, isVisible: async () => true, waitFor: async () => undefined }),
            }),
            evaluate: async () => true,
            keyboard: { press: async () => undefined },
            waitForTimeout: async () => undefined,
        });
        // The saved session is fine; Cloudflare answers the editor visit with its interstitial.
        const healthyPage = pageFor('New story — Medium');
        const challengePage = pageFor('Just a moment...');
        let launchCount = 0;
        const launcher = {
            async launch(options: { headless?: boolean }) {
                launches.push(options);
                launchCount += 1;
                const page = launchCount === 1 ? healthyPage : challengePage;
                return { pages: () => [page], newPage: async () => page, close: async () => undefined };
            },
        };
        try {
            expect(channelConfig().checkHeadedOnly).toBe(true);
            expect(await isAuthenticated(challengePage as never)).toBe(false);
            const result = await new MediumBrowserTransport('script', {
                launcher: launcher as never,
                stepTimeoutMs: 500,
            }).publish({
                content: { title: 'A2UI 1.0', body: 'Hello Medium.', format: 'markdown' },
                options: { profileDir: tmpDir },
            });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('Cloudflare');
            expect(result.metadata?.itcDelivery).toEqual({ schemaVersion: 1, effect: 'none' });
            // headedOnly: one pass, and headed — no headless probe burns the budget first.
            expect(launches.length).toBeGreaterThan(0);
            expect(launches.every((options) => options.headless === false)).toBe(true);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('a missing profile is refused before any headed launch, and nothing is created (0423 R4)', async () => {
        const tmpDir = join(process.cwd(), '.works/tmp/test-medium-absent');
        const absent = join(tmpDir, 'no-medium-profile');
        await mkdir(tmpDir, { recursive: true });
        const launches: unknown[] = [];
        const launcher = {
            async launch(options: unknown) {
                launches.push(options);
                throw new Error('fixture: a missing profile must never reach the launcher');
            },
        };
        try {
            const result = await new MediumBrowserTransport('script', {
                launcher: launcher as never,
                stepTimeoutMs: 500,
            }).publish({
                content: { title: 'A2UI 1.0', body: 'Hello Medium.', format: 'markdown' },
                options: { profileDir: absent },
            });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('no saved profile');
            expect(result.metadata?.itcDelivery).toEqual({ schemaVersion: 1, effect: 'none' });
            // A headed launch would have created the directory and held its lease.
            expect(existsSync(absent)).toBe(false);
            expect(launches).toEqual([]);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('MediumBrowserTransport refuses unsupported driver, unknown publishStatus, and missing session cleanly', async () => {
        const badDriver = await new MediumBrowserTransport('agent').publish({
            content: { title: 'T', body: 'B', format: 'markdown' },
        });
        expect(badDriver.ok).toBe(false);
        expect(badDriver.error).toContain('unsupported driver');

        const badStatus = await new MediumBrowserTransport('script').publish({
            content: { title: 'T', body: 'B', format: 'markdown', metadata: { publishStatus: 'bogus' } },
        });
        expect(badStatus.ok).toBe(false);
        expect(badStatus.error).toContain('unknown publishStatus');
    });

    test('MediumBrowserTransport saves draft and publishes live via mocked BrowserLauncher', async () => {
        const tmpDir = join(process.cwd(), '.works/tmp/test-medium-browser');
        await mkdir(tmpDir, { recursive: true });
        let currentUrl = 'https://medium.com/new-story';
        const clicked: string[] = [];
        const filled: string[] = [];
        const launches: Array<{ headless?: boolean }> = [];
        const fakePage = {
            url: () => currentUrl,
            title: async () => 'New story — Medium',
            goto: async (u: string) => {
                currentUrl = u;
            },
            locator: (sel: string) => ({
                first: () => ({
                    count: async () => 1,
                    isVisible: async () => true,
                    waitFor: async () => undefined,
                    click: async () => {
                        clicked.push(sel);
                        if (sel.includes('publishConfirmButton') || sel.includes('Publish now')) {
                            currentUrl = 'https://medium.com/@robin/a2ui-1-0-abcdef123456';
                        }
                    },
                    fill: async (val: string) => {
                        filled.push(val);
                    },
                    focus: async () => undefined,
                    evaluate: async () => {
                        currentUrl = 'https://medium.com/p/abcdef123456/edit';
                    },
                }),
            }),
            evaluate: async () => {
                currentUrl = 'https://medium.com/p/abcdef123456/edit';
                return true;
            },
            keyboard: { press: async () => undefined },
            waitForTimeout: async () => undefined,
        };
        const fakeLauncher = {
            async launch(options: { headless?: boolean }) {
                launches.push(options);
                return {
                    pages: () => [fakePage],
                    newPage: async () => fakePage,
                    close: async () => undefined,
                };
            },
        };
        try {
            const transport = new MediumBrowserTransport('script', {
                launcher: fakeLauncher as never,
                stepTimeoutMs: 500,
            });
            const draftRes = await transport.publish({
                content: { title: 'A2UI 1.0', body: 'Hello Medium.', format: 'markdown' },
                options: { profileDir: tmpDir },
            });
            expect(draftRes.ok).toBe(true);
            expect(draftRes.id).toBe('abcdef123456');
            expect(draftRes.url).toBe('https://medium.com/p/abcdef123456/edit');
            expect(filled).toContain('A2UI 1.0');
            // 0423 R4: every launch is headed — the headless pass gets Cloudflare's interstitial.
            expect(launches.every((options) => options.headless === false)).toBe(true);

            // Cover title fallback from H1 and live publish flow
            currentUrl = 'https://medium.com/new-story';
            const liveRes = await transport.publish({
                content: {
                    title: '',
                    body: '# A2UI 1.0 Live\n\nHello Medium.',
                    format: 'markdown',
                    metadata: { publishStatus: 'public' },
                },
                options: { profileDir: tmpDir },
            });
            expect(liveRes.ok).toBe(true);
            expect(liveRes.url).toBe('https://medium.com/@robin/a2ui-1-0-abcdef123456');
            expect(clicked.some((s) => s.includes('publishConfirmButton') || s.includes('Publish now'))).toBe(true);

            // Cover profile-check delegating to browser launcher when token is unset
            const checkLines: string[] = [];
            await withEnv({ MEDIUM_INTEGRATION_TOKEN: undefined }, async () => {
                currentUrl = 'https://medium.com/new-story';
                const checkCode = await profileCheckMain(['check', '--profile', tmpDir], {
                    launcher: fakeLauncher as never,
                    stdout: (l) => checkLines.push(l),
                });
                expect(checkCode).toBe(0);
                expect(checkLines.at(-1)).toContain('verified');
            });
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('profile-check exits 0 immediately when MEDIUM_INTEGRATION_TOKEN is configured', async () => {
        const outTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout: outTarget });
        await withEnv({ MEDIUM_INTEGRATION_TOKEN: 'live-token' }, async () => {
            try {
                const code = await profileCheckMain(['check']);
                expect(code).toBe(0);
                expect(outTarget.text()).toContain('MEDIUM_INTEGRATION_TOKEN configured');
            } finally {
                restore();
            }
        });
    });

    test('invocable via runInvoke with medium-pub plugin discovery', async () => {
        const tmpDir = join(process.cwd(), '.works/tmp/test-medium-invoke');
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
                pluginsRoot: resolve(import.meta.dir, '../../..'),
            });
            expect(code).toBe(0);
            expect(ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8'))).ok).toBe(true);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});
