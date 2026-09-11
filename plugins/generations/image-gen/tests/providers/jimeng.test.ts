import { describe, expect, test } from 'bun:test';
import { generateSignature, getImageSize } from '../../src/providers/jimeng';
import { PROVIDERS } from '../../src/providers/types';

describe('jimeng signature', () => {
    test('produces an HMAC-SHA256 authorization string with credential scope', () => {
        const auth = generateSignature(
            'POST',
            { Action: 'CVSync2AsyncSubmitTask', Version: '2022-08-31' },
            { 'content-type': 'application/json', 'X-Date': '20260311T000000Z', Host: 'visual.volcengineapi.com' },
            '{"req_key":"m"}',
            'AK',
            'SK',
            'cn-north-1',
            'cv',
            '/',
        );
        expect(auth.startsWith('HMAC-SHA256 Credential=AK/20260311/cn-north-1/cv/request')).toBe(true);
        expect(auth).toContain('Signature=');
    });

    test('rejects a missing X-Date header', () => {
        expect(() => generateSignature('POST', {}, {}, '', 'AK', 'SK', 'cn-north-1', 'cv', '/')).toThrow('X-Date');
    });
});

describe('jimeng size selection', () => {
    test('explicit pixels win', () => {
        expect(getImageSize('1:1', undefined, 800, 600)).toBe('800x600');
    });

    test('closest preset per quality level', () => {
        expect(getImageSize(undefined, 'normal')).toBe('1024x1024');
        expect(getImageSize(undefined, undefined)).toBe('2048x2048');
        expect(getImageSize('16:9', 'normal')).toBe('1536x864');
        expect(getImageSize('16:9', '2k')).toBe('2560x1440');
        expect(getImageSize('16:9', undefined)).toBe('2560x1440');
        expect(getImageSize('2:1', 'normal')).toBe('1536x864');
    });
});

describe('jimeng provider', () => {
    test('isAvailable needs both halves of its credential pair; refs unsupported at generate time', () => {
        const jimeng = PROVIDERS.jimeng.create({ env: {} });
        expect(jimeng.isAvailable()).toBe(false);
        expect(
            PROVIDERS.jimeng
                .create({ env: { JIMENG_ACCESS_KEY_ID: 'a', JIMENG_SECRET_ACCESS_KEY: 'b' } })
                .isAvailable(),
        ).toBe(true);
        expect(PROVIDERS.jimeng.create({ env: {} }).supportsReferenceImages('jimeng_t2i_v40')).toBe(true);
    });

    test('generate signs submit and (immediately done) polls once', async () => {
        const urls: string[] = [];
        const bodies: string[] = [];
        const _b64 = Buffer.from('img').toString('base64');
        const provider = PROVIDERS.jimeng.create({
            env: { JIMENG_ACCESS_KEY_ID: 'ak', JIMENG_SECRET_ACCESS_KEY: 'sk' },
            fetch: (async (input, init) => {
                urls.push(String(input));
                if (init?.body === undefined)
                    return new Response(new Uint8Array(await new Response('img').arrayBuffer()), { status: 200 });
                bodies.push(String(init.body));
                const payload = JSON.parse(String(init.body)) as { task_id?: string };
                if (payload.task_id === undefined) {
                    return new Response(JSON.stringify({ code: 10_000, data: { task_id: 't-1' } }), { status: 200 });
                }
                return new Response(
                    JSON.stringify({
                        code: 10_000,
                        data: { status: 'done', image_urls: ['https://img.example/x.png'] },
                    }),
                    { status: 200 },
                );
            }) as typeof fetch,
        });
        const result = await provider.generate({ prompt: 'p', model: 'jimeng_t2i_v40' });
        expect(result.extension).toBe('png');
        expect(urls[0]).toContain('Action=CVSync2AsyncSubmitTask');
        expect(urls[1]).toContain('Action=CVSync2AsyncGetResult');
        expect(bodies[0]).toContain('"prompt":"p"');
    });

    test('submit failure surfaces the API message', async () => {
        const provider = PROVIDERS.jimeng.create({
            env: { JIMENG_ACCESS_KEY_ID: 'ak', JIMENG_SECRET_ACCESS_KEY: 'sk' },
            fetch: (async () =>
                new Response(JSON.stringify({ code: 100_500, message: 'quota exceeded' }), {
                    status: 200,
                })) as typeof fetch,
        });
        expect(
            await provider.generate({ prompt: 'p', model: 'jimeng_t2i_v40' }).catch((e: Error) => e.message),
        ).toContain('quota exceeded');
    });

    test('reference images rejected with a routing hint', async () => {
        const provider = PROVIDERS.jimeng.create({ env: { JIMENG_ACCESS_KEY_ID: 'a', JIMENG_SECRET_ACCESS_KEY: 'b' } });
        expect(
            await provider
                .generate({ prompt: 'p', model: 'jimeng_t2i_v40', referenceImages: ['/tmp/a.png'] })
                .catch((e: Error) => e.message),
        ).toContain('--provider google');
    });
});

type JimengPollBody = { code: number; data: Record<string, unknown>; message?: string };

/** Deterministic jimeng double: submit returns t-1; `poll(n)` shapes the n-th poll body. */
function jimengFetch(opts: {
    poll: () => JimengPollBody;
    downloadOk?: boolean;
    pollStatus?: (n: number) => number;
}): typeof fetch {
    let polls = 0;
    return (async (_input, init) => {
        if (init?.body === undefined) {
            // Image-URL download branch (no request init).
            return opts.downloadOk === false
                ? new Response('not found', { status: 404 })
                : new Response('img', { status: 200 });
        }
        const payload = JSON.parse(String(init.body)) as { task_id?: string };
        if (payload.task_id === undefined)
            return new Response(JSON.stringify({ code: 10_000, data: { task_id: 't-1' } }), { status: 200 });
        polls++;
        const status = opts.pollStatus?.(polls) ?? 200;
        return new Response(JSON.stringify(opts.poll()), { status });
    }) as typeof fetch;
}

describe('jimeng generate — uncovered branches (0116 coverage follow-up)', () => {
    const ENV = { JIMENG_ACCESS_KEY_ID: 'ak', JIMENG_SECRET_ACCESS_KEY: 'sk' };

    test('submit HTTP failure surfaces status + body text', async () => {
        const provider = PROVIDERS.jimeng.create({
            env: ENV,
            fetch: (async () => new Response('rate limited', { status: 429 })) as typeof fetch,
        });
        const message = await provider
            .generate({ prompt: 'p', model: 'jimeng_t2i_v40' })
            .catch((e: Error) => e.message);
        expect(message).toContain('Jimeng API submit error (429)');
        expect(message).toContain('rate limited');
    });

    test('missing credentials fail loudly before any request', async () => {
        const provider = PROVIDERS.jimeng.create({ env: {} });
        const message = await provider
            .generate({ prompt: 'p', model: 'jimeng_t2i_v40' })
            .catch((e: Error) => e.message);
        expect(message).toContain('JIMENG_ACCESS_KEY_ID and JIMENG_SECRET_ACCESS_KEY are required');
    });

    test('poll returns inline binary_data_base64 when present', async () => {
        const b64 = Buffer.from('inline-bytes').toString('base64');
        const provider = PROVIDERS.jimeng.create({
            env: ENV,
            fetch: jimengFetch({
                poll: () => ({ code: 10_000, data: { binary_data_base64: [b64], status: 'done' } }),
            }),
        });
        const result = await provider.generate({ prompt: 'p', model: 'jimeng_t2i_v40' });
        expect(new TextDecoder().decode(result.bytes)).toBe('inline-bytes');
        expect(result.provider).toBe('jimeng');
    });

    test('in_queue polls again, then done with image download', async () => {
        let polls = 0;
        const provider = PROVIDERS.jimeng.create({
            env: ENV,
            fetch: jimengFetch({
                poll: () => {
                    polls++;
                    return polls === 1
                        ? { code: 10_000, data: { status: 'in_queue' } }
                        : { code: 10_000, data: { status: 'done', image_urls: ['https://img.example/x.png'] } };
                },
            }),
        });
        const result = await provider.generate({ prompt: 'p', model: 'jimeng_t2i_v40' });
        expect(polls).toBe(2);
        expect(new TextDecoder().decode(result.bytes)).toBe('img');
    });

    test('failed download of a done-task image URL is loud', async () => {
        const provider = PROVIDERS.jimeng.create({
            env: ENV,
            fetch: jimengFetch({
                poll: () => ({ code: 10_000, data: { status: 'done', image_urls: ['https://img.example/x.png'] } }),
                downloadOk: false,
            }),
        });
        const message = await provider
            .generate({ prompt: 'p', model: 'jimeng_t2i_v40' })
            .catch((e: Error) => e.message);
        expect(message).toBe('Failed to download image from https://img.example/x.png');
    });

    test('status=fail and unexpected codes surface provider messages', async () => {
        const make = (pollBody: unknown) =>
            PROVIDERS.jimeng.create({
                env: ENV,
                fetch: (async (_input, init) => {
                    if (init?.body === undefined)
                        return new Response(JSON.stringify({ code: 10_000, data: { task_id: 't-1' } }), {
                            status: 200,
                        });
                    const payload = JSON.parse(String(init.body)) as { task_id?: string };
                    if (payload.task_id === undefined)
                        return new Response(JSON.stringify({ code: 10_000, data: { task_id: 't-1' } }), {
                            status: 200,
                        });
                    return new Response(JSON.stringify(pollBody), { status: 200 });
                }) as typeof fetch,
            });
        expect(
            await make({ code: 10_000, data: { status: 'fail' }, message: 'content policy' })
                .generate({ prompt: 'p', model: 'jimeng_t2i_v40' })
                .catch((e: Error) => e.message),
        ).toContain('Jimeng task failed: content policy');
        expect(
            await make({ code: 10_000, data: { status: 'done' } })
                .generate({ prompt: 'p', model: 'jimeng_t2i_v40' })
                .catch((e: Error) => e.message),
        ).toContain('Unexpected response during polling');
    });

    test('poll HTTP failure is loud with status', async () => {
        let polls = 0;
        const provider = PROVIDERS.jimeng.create({
            env: ENV,
            fetch: jimengFetch({
                poll: () => {
                    polls++;
                    return polls === 1
                        ? { code: 10_000, data: { status: 'in_queue' } }
                        : { code: 10_000, data: { status: 'done' } };
                },
                pollStatus: (n) => (n >= 2 ? 500 : 200),
            }),
        });
        const message = await provider
            .generate({ prompt: 'p', model: 'jimeng_t2i_v40' })
            .catch((e: Error) => e.message);
        expect(message).toContain('Jimeng API poll error (500)');
    });

    test('invalid JIMENG_BASE_URL throws from endpoint resolution', async () => {
        const provider = PROVIDERS.jimeng.create({
            env: { ...ENV, JIMENG_BASE_URL: 'not-a-url' },
            fetch: (async () => new Response('{}', { status: 200 })) as typeof fetch,
        });
        const message = await provider
            .generate({ prompt: 'p', model: 'jimeng_t2i_v40' })
            .catch((e: Error) => e.message);
        expect(message).toContain('Invalid JIMENG_BASE_URL');
    });
});
