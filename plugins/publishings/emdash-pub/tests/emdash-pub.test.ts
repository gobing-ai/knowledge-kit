import { describe, expect, spyOn, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport } from '@gobing-ai/publish-harness';
import { logger } from '@gobing-ai/utils';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import {
    EmDashApiTransport,
    type EmDashCreateEnvelope,
    getPublishTransport,
    main,
    mapContentToEmDashCreate,
    markdownToPortableText,
    processPublishIO,
    slugify,
} from '../src/index';

/** Captured EmDash API request for offline assertions. */
interface CapturedRequest {
    url: string;
    method: string;
    headers: Headers;
    body: unknown;
}

/** Sandboxed env helpers: restore original values after each test. */
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

describe('emdash-pub plugin', () => {
    test('slugify converts strings into lowercase hyphenated slugs', () => {
        expect(slugify('Hello World')).toBe('hello-world');
        expect(slugify('  TypeScript & Bun  ')).toBe('typescript-bun');
        expect(slugify('日本語')).toBe('');
    });

    test('mapContentToEmDashCreate uses Content.title when present', () => {
        const content: Content = {
            title: 'My EmDash Post',
            body: 'First paragraph.\n\nSecond paragraph.',
            format: 'markdown',
        };
        const envelope = mapContentToEmDashCreate(content);
        expect(envelope.data.title).toBe('My EmDash Post');
        expect(envelope.slug).toBe('my-emdash-post');
    });

    test('mapContentToEmDashCreate falls back to the first ATX # heading and drops that line', () => {
        const content: Content = {
            body: '# Heading Title\n\nBody paragraph.',
            format: 'markdown',
        };
        const envelope = mapContentToEmDashCreate(content);
        expect(envelope.data.title).toBe('Heading Title');
        expect(envelope.slug).toBe('heading-title');
        // The consumed # line is dropped: no h1 block, no leftover-heading throw.
        expect(envelope.data.content).toEqual([
            {
                _type: 'block',
                style: 'normal',
                children: [{ _type: 'span', text: 'Body paragraph.' }],
            },
        ]);
    });

    test('mapContentToEmDashCreate fails loud when no title can be resolved', () => {
        const content: Content = {
            body: '## Subheading only\n\nNo h1 title anywhere.',
            format: 'markdown',
        };
        expect(() => mapContentToEmDashCreate(content)).toThrow('Cannot resolve title');
    });

    test('mapContentToEmDashCreate fails loud when the title slugifies to empty', () => {
        const content: Content = {
            title: '!!!',
            body: 'Body.',
            format: 'markdown',
        };
        expect(() => mapContentToEmDashCreate(content)).toThrow('Cannot derive slug from title');
    });

    test('mapContentToEmDashCreate maps status published only when metadata.published is true', () => {
        const draft: Content = { title: 'Draft Post', body: 'Body.', format: 'markdown' };
        expect(mapContentToEmDashCreate(draft).status).toBe('draft');

        const explicitDraft: Content = {
            title: 'Draft Post',
            body: 'Body.',
            format: 'markdown',
            metadata: { published: false },
        };
        expect(mapContentToEmDashCreate(explicitDraft).status).toBe('draft');

        const published: Content = {
            title: 'Published Post',
            body: 'Body.',
            format: 'markdown',
            metadata: { published: true },
        };
        expect(mapContentToEmDashCreate(published).status).toBe('published');
    });

    test('mapContentToEmDashCreate uses metadata.description or first paragraph as excerpt', () => {
        const withDescription: Content = {
            title: 'Excerpt',
            body: 'Lead paragraph.\n\nSecond paragraph.',
            format: 'markdown',
            metadata: { description: 'Explicit description' },
        };
        const explicit = mapContentToEmDashCreate(withDescription);
        expect(explicit.data.excerpt).toBe('Explicit description');

        const withParagraph: Content = {
            title: 'Excerpt',
            body: 'Lead paragraph.\n\nSecond paragraph.',
            format: 'markdown',
        };
        const inferred = mapContentToEmDashCreate(withParagraph);
        expect(inferred.data.excerpt).toBe('Lead paragraph.');

        // Heading lines are skipped when scanning for the excerpt paragraph.
        const headingSkipped: Content = {
            body: '# Heading\n\nLead paragraph.\n\nSecond paragraph.',
            format: 'markdown',
        };
        expect(mapContentToEmDashCreate(headingSkipped).data.excerpt).toBe('Lead paragraph.');

        const noExcerpt: Content = { title: 'Excerpt', body: '', format: 'markdown' };
        expect(mapContentToEmDashCreate(noExcerpt).data.excerpt).toBeUndefined();
    });

    test('mapContentToEmDashCreate honors metadata.slug over slugify(title)', () => {
        const content: Content = {
            title: 'My Post',
            body: 'Body.',
            format: 'markdown',
            metadata: { slug: 'custom-slug' },
        };
        expect(mapContentToEmDashCreate(content).slug).toBe('custom-slug');
    });

    test('markdownToPortableText maps v1 blocks: paragraphs, headings, blockquote, lists, code', () => {
        const markdown = [
            '## Section',
            '',
            'A paragraph with **strong** and *emphasis*.',
            '',
            '> A quoted line',
            '',
            '- bullet one',
            '- bullet two',
            '',
            '1. numbered one',
            '2. numbered two',
            '',
            '```ts',
            'const x = 1;',
            '```',
        ].join('\n');

        const blocks = markdownToPortableText(markdown);
        expect(blocks).toEqual([
            {
                _type: 'block',
                style: 'h2',
                children: [{ _type: 'span', text: 'Section' }],
            },
            {
                _type: 'block',
                style: 'normal',
                children: [
                    { _type: 'span', text: 'A paragraph with ' },
                    { _type: 'span', text: 'strong', marks: ['strong'] },
                    { _type: 'span', text: ' and ' },
                    { _type: 'span', text: 'emphasis', marks: ['em'] },
                    { _type: 'span', text: '.' },
                ],
            },
            {
                _type: 'block',
                style: 'blockquote',
                children: [{ _type: 'span', text: 'A quoted line' }],
            },
            {
                _type: 'block',
                style: 'normal',
                listItem: 'bullet',
                children: [{ _type: 'span', text: 'bullet one' }],
            },
            {
                _type: 'block',
                style: 'normal',
                listItem: 'bullet',
                children: [{ _type: 'span', text: 'bullet two' }],
            },
            {
                _type: 'block',
                style: 'normal',
                listItem: 'number',
                children: [{ _type: 'span', text: 'numbered one' }],
            },
            {
                _type: 'block',
                style: 'normal',
                listItem: 'number',
                children: [{ _type: 'span', text: 'numbered two' }],
            },
            { _type: 'code', language: 'ts', code: 'const x = 1;' },
        ]);
    });

    test('markdownToPortableText maps inline links with sequential link markDefs', () => {
        const blocks = markdownToPortableText('See [docs](https://docs.example.com) and [more](https://example.com).');
        expect(blocks).toEqual([
            {
                _type: 'block',
                style: 'normal',
                children: [
                    { _type: 'span', text: 'See ' },
                    { _type: 'span', text: 'docs', marks: ['link-0'] },
                    { _type: 'span', text: ' and ' },
                    { _type: 'span', text: 'more', marks: ['link-1'] },
                    { _type: 'span', text: '.' },
                ],
                markDefs: [
                    { _type: 'link', href: 'https://docs.example.com', _key: 'link-0' },
                    { _type: 'link', href: 'https://example.com', _key: 'link-1' },
                ],
            },
        ]);
    });

    test('markdownToPortableText supports _em_ underscore emphasis', () => {
        const blocks = markdownToPortableText('An _italic_ word.');
        expect(blocks[0]?.children).toContainEqual({ _type: 'span', text: 'italic', marks: ['em'] });
    });

    test('markdownToPortableText maps h3 and h4 headings to their styles', () => {
        const blocks = markdownToPortableText('### Third level\n\n#### Fourth level');
        expect(blocks).toEqual([
            { _type: 'block', style: 'h3', children: [{ _type: 'span', text: 'Third level' }] },
            { _type: 'block', style: 'h4', children: [{ _type: 'span', text: 'Fourth level' }] },
        ]);
    });

    test('markdownToPortableText throws on leftover h1 headings', () => {
        expect(() => markdownToPortableText('# Leftover Heading\n\nBody.')).toThrow(
            'Unsupported markdown construct: h1',
        );
    });

    test('markdownToPortableText throws on pipe tables', () => {
        expect(() => markdownToPortableText('| a | b |\n|---|---|')).toThrow('Unsupported markdown construct: table');
    });

    test('markdownToPortableText throws on raw HTML', () => {
        expect(() => markdownToPortableText('Before <div>inside</div> after.')).toThrow(
            'Unsupported markdown construct: html',
        );
    });

    test('markdownToPortableText throws on markdown images', () => {
        expect(() => markdownToPortableText('See ![alt](https://example.com/x.png)')).toThrow(
            'Unsupported markdown construct: image',
        );
    });

    test('markdownToPortableText leaves fenced code content untouched by construct checks', () => {
        const blocks = markdownToPortableText('```\n| not a table\n<div>not html</div>\n```');
        expect(blocks).toEqual([{ _type: 'code', code: '| not a table\n<div>not html</div>' }]);
    });

    test('EmDashApiTransport fails loud when EMDASH_URL is missing', async () => {
        await withEnv({ EMDASH_URL: undefined, EMDASH_TOKEN: 'test-token' }, async () => {
            const transport = new EmDashApiTransport();
            const content: Content = { title: 'No URL', body: 'Body.', format: 'markdown' };
            const result = await transport.publish({ content });
            expect(result.ok).toBe(false);
            expect(result.target).toBe('emdash');
            expect(result.error).toContain('EMDASH_URL environment variable is required');
        });
    });

    test('EmDashApiTransport fails loud when EMDASH_TOKEN is missing or whitespace-only', async () => {
        await withEnv({ EMDASH_URL: 'https://example.com', EMDASH_TOKEN: undefined }, async () => {
            const transport = new EmDashApiTransport();
            const content: Content = { title: 'No Token', body: 'Body.', format: 'markdown' };
            const result = await transport.publish({ content });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('EMDASH_TOKEN environment variable is required');
        });

        await withEnv({ EMDASH_URL: 'https://example.com', EMDASH_TOKEN: '   ' }, async () => {
            const transport = new EmDashApiTransport();
            const content: Content = { title: 'Blank Token', body: 'Body.', format: 'markdown' };
            const result = await transport.publish({ content });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('EMDASH_TOKEN environment variable is required');
        });
    });

    test('EmDashApiTransport publishes via a mocked 201 with url, id, and the create envelope', async () => {
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
                    success: true,
                    data: { item: { id: '01JX8TESTPOSTID000', slug: 'my-post' } },
                }),
                { status: 201 },
            );
        }) as typeof fetch);

        await withEnv(
            {
                EMDASH_URL: 'https://blog.example.com/',
                EMDASH_TOKEN: 'test-token-must-not-leak',
                EMDASH_PUBLIC_POST_PATH: '/blog/{slug}',
            },
            async () => {
                try {
                    const transport = new EmDashApiTransport();
                    const content: Content = {
                        title: 'My Post',
                        body: 'First paragraph.',
                        format: 'markdown',
                    };

                    const result = await transport.publish({ content });
                    expect(result.ok).toBe(true);
                    expect(result.target).toBe('emdash');
                    expect(result.id).toBe('01JX8TESTPOSTID000');
                    expect(result.url).toBe('https://blog.example.com/blog/my-post');
                    expect(result.message).toBe('Published successfully to EmDash via the REST token transport');

                    expect(captured?.url).toBe('https://blog.example.com/_emdash/api/content/posts');
                    expect(captured?.method).toBe('POST');
                    expect(captured?.headers.get('Authorization')).toBe('Bearer test-token-must-not-leak');
                    expect(captured?.headers.get('Content-Type')).toBe('application/json');
                    const envelope = captured?.body as EmDashCreateEnvelope;
                    expect(envelope.slug).toBe('my-post');
                    expect(envelope.status).toBe('draft');
                    expect(envelope.data.title).toBe('My Post');
                    expect(envelope.data.content).toEqual([
                        {
                            _type: 'block',
                            style: 'normal',
                            children: [{ _type: 'span', text: 'First paragraph.' }],
                        },
                    ]);
                } finally {
                    fetchSpy.mockRestore();
                }
            },
        );
    });

    test('EmDashApiTransport includes the public post path with {slug} only when configured', async () => {
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (): Promise<Response> => {
            return new Response(JSON.stringify({ success: true, data: { item: { id: 'post-1' } } }), { status: 200 });
        }) as unknown as typeof fetch);

        try {
            await withEnv(
                { EMDASH_URL: 'https://example.com', EMDASH_TOKEN: 'tok', EMDASH_PUBLIC_POST_PATH: '/static/' },
                async () => {
                    const transport = new EmDashApiTransport();
                    const content: Content = { title: 'Bad Path', body: 'Body.', format: 'markdown' };
                    const result = await transport.publish({ content });
                    expect(result.ok).toBe(false);
                    expect(result.error).toContain('EMDASH_PUBLIC_POST_PATH');
                },
            );

            await withEnv({ EMDASH_URL: 'https://example.com', EMDASH_TOKEN: 'tok' }, async () => {
                const transport = new EmDashApiTransport();
                const content: Content = { title: 'No Path', body: 'Body.', format: 'markdown' };
                const result = await transport.publish({ content });
                expect(result.ok).toBe(true);
                expect(result.url).toBeUndefined();
            });
        } finally {
            fetchSpy.mockRestore();
        }
    });

    test('EmDashApiTransport fails loud with HTTP status and error code on 401', async () => {
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (): Promise<Response> => {
            return new Response(
                JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Bad credentials' } }),
                { status: 401, statusText: 'Unauthorized' },
            );
        }) as unknown as typeof fetch);

        await withEnv({ EMDASH_URL: 'https://example.com', EMDASH_TOKEN: 'test-token-must-not-leak' }, async () => {
            try {
                const transport = new EmDashApiTransport();
                const content: Content = { title: 'Unauthorized', body: 'Body.', format: 'markdown' };
                const result = await transport.publish({ content });
                expect(result.ok).toBe(false);
                expect(result.target).toBe('emdash');
                expect(result.error).toContain('HTTP 401');
                expect(result.error).toContain('UNAUTHORIZED');
            } finally {
                fetchSpy.mockRestore();
            }
        });
    });

    test('EmDashApiTransport fails loud with SLUG_CONFLICT at any HTTP status', async () => {
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (): Promise<Response> => {
            return new Response(
                JSON.stringify({ success: false, error: { code: 'SLUG_CONFLICT', message: 'Slug taken' } }),
                { status: 200 },
            );
        }) as unknown as typeof fetch);

        await withEnv({ EMDASH_URL: 'https://example.com', EMDASH_TOKEN: 'tok' }, async () => {
            try {
                const transport = new EmDashApiTransport();
                const content: Content = { title: 'Conflict', body: 'Body.', format: 'markdown' };
                const result = await transport.publish({ content });
                expect(result.ok).toBe(false);
                expect(result.error).toContain('SLUG_CONFLICT');
            } finally {
                fetchSpy.mockRestore();
            }
        });
    });

    test('EmDashApiTransport fails loud when data.item.id is missing', async () => {
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (): Promise<Response> => {
            return new Response(JSON.stringify({ success: true, data: { item: {} } }), { status: 201 });
        }) as unknown as typeof fetch);

        await withEnv({ EMDASH_URL: 'https://example.com', EMDASH_TOKEN: 'tok' }, async () => {
            try {
                const transport = new EmDashApiTransport();
                const content: Content = { title: 'No Id', body: 'Body.', format: 'markdown' };
                const result = await transport.publish({ content });
                expect(result.ok).toBe(false);
                expect(result.error).toContain('HTTP 201');
            } finally {
                fetchSpy.mockRestore();
            }
        });
    });

    test('EmDashApiTransport fails loud with a transport error on network failure', async () => {
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (): Promise<Response> => {
            throw new Error('network down');
        }) as unknown as typeof fetch);

        await withEnv({ EMDASH_URL: 'https://example.com', EMDASH_TOKEN: 'tok' }, async () => {
            try {
                const transport = new EmDashApiTransport();
                const content: Content = { title: 'Network Failure', body: 'Body.', format: 'markdown' };
                const result = await transport.publish({ content });
                expect(result.ok).toBe(false);
                expect(result.error).toContain('EmDash transport error: network down');
            } finally {
                fetchSpy.mockRestore();
            }
        });
    });

    test('EmDashApiTransport reports Unknown error detail when the response body is not JSON', async () => {
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (): Promise<Response> => {
            return new Response('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' });
        }) as unknown as typeof fetch);

        await withEnv({ EMDASH_URL: 'https://example.com', EMDASH_TOKEN: 'tok' }, async () => {
            try {
                const transport = new EmDashApiTransport();
                const content: Content = { title: 'Proxy Error', body: 'Body.', format: 'markdown' };
                const result = await transport.publish({ content });
                expect(result.ok).toBe(false);
                expect(result.error).toContain('HTTP 502');
                expect(result.error).toContain('Unknown error');
            } finally {
                fetchSpy.mockRestore();
            }
        });
    });

    test('EmDashApiTransport omits the error code part when code is not a string', async () => {
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (): Promise<Response> => {
            return new Response(JSON.stringify({ success: false, error: { message: 'Bad payload' } }), {
                status: 400,
            });
        }) as unknown as typeof fetch);

        await withEnv({ EMDASH_URL: 'https://example.com', EMDASH_TOKEN: 'tok' }, async () => {
            try {
                const transport = new EmDashApiTransport();
                const content: Content = { title: 'Bad Payload', body: 'Body.', format: 'markdown' };
                const result = await transport.publish({ content });
                expect(result.ok).toBe(false);
                expect(result.error).toContain('HTTP 400');
                expect(result.error).not.toContain(', code ');
            } finally {
                fetchSpy.mockRestore();
            }
        });
    });

    test('EmDashApiTransport uses EMDASH_COLLECTION in the request path', async () => {
        let capturedUrl: string | undefined;
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
            input: Parameters<typeof fetch>[0],
        ): Promise<Response> => {
            capturedUrl = String(input);
            return new Response(JSON.stringify({ success: true, data: { item: { id: 'post-1' } } }), {
                status: 201,
            });
        }) as unknown as typeof fetch);

        await withEnv(
            { EMDASH_URL: 'https://example.com', EMDASH_TOKEN: 'tok', EMDASH_COLLECTION: 'news' },
            async () => {
                try {
                    const transport = new EmDashApiTransport();
                    const content: Content = { title: 'Collection Test', body: 'Body.', format: 'markdown' };
                    const result = await transport.publish({ content });
                    expect(result.ok).toBe(true);
                    expect(capturedUrl).toBe('https://example.com/_emdash/api/content/news');
                } finally {
                    fetchSpy.mockRestore();
                }
            },
        );
    });

    test('EmDashApiTransport defaults the collection to posts', async () => {
        let capturedUrl: string | undefined;
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
            input: Parameters<typeof fetch>[0],
        ): Promise<Response> => {
            capturedUrl = String(input);
            return new Response(JSON.stringify({ success: true, data: { item: { id: 'post-1' } } }), {
                status: 201,
            });
        }) as unknown as typeof fetch);

        await withEnv({ EMDASH_URL: 'https://example.com', EMDASH_TOKEN: 'tok' }, async () => {
            try {
                const transport = new EmDashApiTransport();
                const content: Content = { title: 'Default Collection', body: 'Body.', format: 'markdown' };
                await transport.publish({ content });
                expect(capturedUrl).toBe('https://example.com/_emdash/api/content/posts');
            } finally {
                fetchSpy.mockRestore();
            }
        });
    });

    test('EmDashApiTransport maps Content before fetch and returns ok false on mapping failure', async () => {
        let fetchCalled = false;
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (): Promise<Response> => {
            fetchCalled = true;
            throw new Error('fetch must not be called for unmappable content');
        }) as unknown as typeof fetch);

        await withEnv({ EMDASH_URL: 'https://example.com', EMDASH_TOKEN: 'tok' }, async () => {
            try {
                const transport = new EmDashApiTransport();
                const content: Content = {
                    title: 'Bad Table',
                    body: '| a | b |',
                    format: 'markdown',
                };
                const result = await transport.publish({ content });
                expect(result.ok).toBe(false);
                expect(result.error).toContain('Unsupported markdown construct: table');
                expect(fetchCalled).toBe(false);
            } finally {
                fetchSpy.mockRestore();
            }
        });
    });

    test('Result JSON never contains the raw token value', async () => {
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (): Promise<Response> => {
            return new Response(JSON.stringify({ success: true, data: { item: { id: 'post-1' } } }), { status: 201 });
        }) as unknown as typeof fetch);

        await withEnv({ EMDASH_URL: 'https://example.com', EMDASH_TOKEN: 'test-token-must-not-leak' }, async () => {
            try {
                const transport = new EmDashApiTransport();
                const content: Content = { title: 'Secret Hygiene', body: 'Body.', format: 'markdown' };
                const result = await transport.publish({ content });
                expect(JSON.stringify(result)).not.toContain('test-token-must-not-leak');
                expect(JSON.stringify(result)).not.toContain('EMDASH_TOKEN');
            } finally {
                fetchSpy.mockRestore();
            }
        });
    });

    test('getPublishTransport resolves EmDashApiTransport by default and FakeFileCliTransport when configured', () => {
        expect(getPublishTransport()).toBeInstanceOf(EmDashApiTransport);
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(getPublishTransport()).toBeInstanceOf(FakeFileCliTransport);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }
    });

    test('processPublishIO executes offline via FakeFileCliTransport without external effects', async () => {
        const fakeTransport = new FakeFileCliTransport();
        const tmpDir = join(process.cwd(), '.tmp-test-emdash');
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
            target: 'emdash',
            error: 'Simulated EmDash API failure',
        });

        const tmpDir = join(process.cwd(), '.tmp-test-emdash-fail');
        await mkdir(tmpDir, { recursive: true });

        const inPath = join(tmpDir, 'input-content.json');
        const outPath = join(tmpDir, 'output-result.json');

        const inputContent: Content = {
            title: 'Test Fail',
            body: 'Body content for fail test.',
            format: 'markdown',
        };

        await writeFile(inPath, JSON.stringify(inputContent), 'utf-8');

        expect(processPublishIO(inPath, outPath, fakeTransport)).rejects.toThrow('Simulated EmDash API failure');

        const resultJson = JSON.parse(await readFile(outPath, 'utf-8'));
        const result = ResultSchema.parse(resultJson);

        expect(result.ok).toBe(false);
        expect(result.target).toBe('emdash');
        expect(result.error).toBe('Simulated EmDash API failure');

        await rm(tmpDir, { recursive: true, force: true });
    });

    test('processPublishIO writes error Result on validation failure', async () => {
        const tmpDir = join(process.cwd(), '.tmp-test-emdash-validate');
        await mkdir(tmpDir, { recursive: true });

        const inPath = join(tmpDir, 'input-content.json');
        const outPath = join(tmpDir, 'output-result.json');

        // Missing required `body` field violates ContentSchema.
        await writeFile(inPath, JSON.stringify({ title: 'No Body' }), 'utf-8');

        expect(processPublishIO(inPath, outPath, new FakeFileCliTransport())).rejects.toThrow('Invalid Content input');

        const resultJson = JSON.parse(await readFile(outPath, 'utf-8'));
        const result = ResultSchema.parse(resultJson);

        expect(result.ok).toBe(false);
        expect(result.target).toBe('emdash');
        expect(result.error).toContain('Invalid Content input');

        await rm(tmpDir, { recursive: true, force: true });
    });

    test('main CLI entry handles argument parsing and fake-transport success', async () => {
        const origArgv = process.argv;
        process.argv = ['bun', 'index.ts'];
        const errorSpy = spyOn(logger, 'error').mockImplementation(() => {});
        try {
            expect(await main()).toBe(1);
            expect(errorSpy).toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
        }

        const tmpDir = join(process.cwd(), '.tmp-test-emdash-main');
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

    test('main returns 1 when publish fails and writes the error Result', async () => {
        const origArgv = process.argv;
        const origUrl = process.env.EMDASH_URL;
        delete process.env.EMDASH_URL;
        delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        const errorSpy = spyOn(logger, 'error').mockImplementation(() => {});

        const tmpDir = join(process.cwd(), '.tmp-test-emdash-main-fail');
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
            expect(errorSpy).toHaveBeenCalled();

            const resultJson = JSON.parse(await readFile(outPath, 'utf-8'));
            expect(ResultSchema.parse(resultJson).ok).toBe(false);
        } finally {
            errorSpy.mockRestore();
            process.argv = origArgv;
            if (origUrl !== undefined) process.env.EMDASH_URL = origUrl;
            else delete process.env.EMDASH_URL;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('main returns 1 and logs when parseArgs rejects an unknown option', async () => {
        const origArgv = process.argv;
        process.argv = ['bun', 'index.ts', '--bogus'];
        const errorSpy = spyOn(logger, 'error').mockImplementation(() => {});
        try {
            expect(await main()).toBe(1);
            expect(errorSpy).toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
            process.argv = origArgv;
        }
    });

    test('invocable via runInvoke with emdash-pub plugin discovery', async () => {
        const tmpDir = join(process.cwd(), '.tmp-test-emdash-invoke');
        await mkdir(tmpDir, { recursive: true });

        const inPath = join(tmpDir, 'in-content.json');
        const outPath = join(tmpDir, 'out-result.json');

        const inputContent: Content = {
            title: 'Invoke Integration Test',
            body: 'Integration testing emdash-pub with runInvoke.',
            format: 'markdown',
        };

        await writeFile(inPath, JSON.stringify(inputContent), 'utf-8');

        const pluginsRoot = join(process.cwd(), 'plugins');
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            const code = await runInvoke({
                plugin: 'emdash-pub',
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
