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
    test('isAvailable needs both keys; refs unsupported at generate time', () => {
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
