import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Content } from '@gobing-ai/kk-core';
import { FakeBrowserTransport, FakeFileCliTransport, resolveBrowserProfileDir, trySelectors } from '../src/index';

describe('FakeFileCliTransport', () => {
    test('executes offline publish without external side effects', async () => {
        const transport = new FakeFileCliTransport();
        const sampleContent: Content = {
            title: 'Sample Surfdash Article',
            body: '# Hello World\n\nSample body for publishing.',
            format: 'markdown',
            metadata: {
                tags: ['test', 'harness'],
                description: 'A sample description.',
            },
        };

        const result = await transport.publish({ content: sampleContent });

        expect(result.ok).toBe(true);
        expect(result.target).toBe('fake-file-cli');
        expect(result.url).toBe('https://example.com/published-post');

        const logs = transport.getCallLogs();
        expect(logs.length).toBe(1);
        expect(logs[0]?.payload.content.title).toBe('Sample Surfdash Article');
    });

    test('supports setting custom failure result', async () => {
        const transport = new FakeFileCliTransport();
        transport.setNextResult({
            ok: false,
            target: 'fake-file-cli',
            error: 'Simulated CLI failure',
        });

        const sampleContent: Content = {
            body: 'Broken content',
            format: 'markdown',
        };

        const result = await transport.publish({ content: sampleContent });

        expect(result.ok).toBe(false);
        expect(result.error).toBe('Simulated CLI failure');
    });

    test('resets call logs and custom next result', async () => {
        const transport = new FakeFileCliTransport();
        expect(transport.kind).toBe('file-cli');
        transport.setNextResult({ ok: false, target: 'fake' });
        await transport.publish({ content: { body: 'test', format: 'markdown' } });
        expect(transport.getCallLogs().length).toBe(1);

        transport.reset();
        expect(transport.getCallLogs().length).toBe(0);

        const freshResult = await transport.publish({ content: { body: 'fresh', format: 'markdown' } });
        expect(freshResult.ok).toBe(true);
    });
});

describe('FakeBrowserTransport', () => {
    test('kind is browser and default driver is agent', () => {
        const transport = new FakeBrowserTransport();
        expect(transport.kind).toBe('browser');
        expect(transport.driver).toBe('agent');
    });

    test('accepts script driver without growing a third kind', () => {
        const transport = new FakeBrowserTransport('script');
        expect(transport.kind).toBe('browser');
        expect(transport.driver).toBe('script');
    });

    test('executes offline publish without a live browser or network', async () => {
        const transport = new FakeBrowserTransport('agent');
        const sampleContent: Content = {
            title: 'Draft',
            body: '# Hello',
            format: 'markdown',
        };

        const result = await transport.publish({ content: sampleContent });

        expect(result.ok).toBe(true);
        expect(result.target).toBe('fake-browser');
        expect(result.id).toBe('fake-browser-id-123');
        expect(result.metadata?.driver).toBe('agent');
        expect(transport.getCallLogs()).toHaveLength(1);
        expect(transport.getCallLogs()[0]?.payload.content.title).toBe('Draft');
    });

    test('supports setting custom failure result', async () => {
        const transport = new FakeBrowserTransport();
        transport.setNextResult({
            ok: false,
            target: 'fake-browser',
            error: 'Simulated browser failure',
        });

        const result = await transport.publish({
            content: { body: 'x', format: 'markdown' },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toBe('Simulated browser failure');
    });

    test('resets call logs and custom next result', async () => {
        const transport = new FakeBrowserTransport('script');
        transport.setNextResult({ ok: false, target: 'fake-browser' });
        await transport.publish({ content: { body: 'test', format: 'markdown' } });
        expect(transport.getCallLogs()).toHaveLength(1);

        transport.reset();
        expect(transport.getCallLogs()).toHaveLength(0);

        const fresh = await transport.publish({ content: { body: 'fresh', format: 'markdown' } });
        expect(fresh.ok).toBe(true);
        expect(fresh.metadata?.driver).toBe('script');
    });
});

describe('resolveBrowserProfileDir', () => {
    test('defaults to ~/.config/kk/browser-profiles/<channel>', () => {
        expect(resolveBrowserProfileDir('juejin')).toBe(join(homedir(), '.config', 'kk', 'browser-profiles', 'juejin'));
    });

    test('override wins, expanding a ~/ prefix', () => {
        expect(resolveBrowserProfileDir('x', '~/custom-x-profile')).toBe(join(homedir(), 'custom-x-profile'));
        expect(resolveBrowserProfileDir('x', '/tmp/x-profile')).toBe('/tmp/x-profile');
    });
});

describe('trySelectors', () => {
    test('returns the first attached visible selector', async () => {
        const page = {
            locator(selector: string) {
                return {
                    first() {
                        return {
                            async count() {
                                return selector === '#hit' ? 1 : 0;
                            },
                            async isVisible() {
                                return selector === '#hit';
                            },
                        };
                    },
                };
            },
        };

        const result = await trySelectors(page, ['#miss', '#hit', '#later']);
        expect(result).toEqual({ found: true, selector: '#hit' });
    });

    test('returns not-found when nothing matches', async () => {
        const page = {
            locator() {
                return {
                    first() {
                        return {
                            async count() {
                                return 0;
                            },
                            async isVisible() {
                                return false;
                            },
                        };
                    },
                };
            },
        };

        const result = await trySelectors(page, ['#a', '#b']);
        expect(result).toEqual({ found: false, selector: null });
    });
});
