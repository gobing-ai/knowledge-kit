import { describe, expect, test } from 'bun:test';
import type { Content } from '@gobing-ai/kk-core';
import { FakeFileCliTransport } from '../src/index';

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
