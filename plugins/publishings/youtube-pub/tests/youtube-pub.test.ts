import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { videoGenContentSchema } from '@gobing-ai/kk-core';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { credentialsFilePath, loadYouTubeCredentials, redact } from '../src/credentials';
import { main, processPublishIO } from '../src/index';
import {
    buildUploadBody,
    shortsDescription,
    shortsUrl,
    uploadTimeoutMs,
    YOUTUBE_TITLE_MAX,
    YOUTUBE_TOKEN_URL,
    YOUTUBE_UPLOAD_URL,
    YouTubeClient,
} from '../src/youtube-client';

/**
 * AC1 / AC2 (R1–R5) — the API publisher against an injected `fetchImpl`: one token refresh, one
 * resumable init, one PUT of the bytes, private-first, `#Shorts` in the description, a Shorts URL in
 * the Result, no secret anywhere — and every invalid input refused with **zero** fetches.
 */

const CREDS = { clientId: 'client-1', clientSecret: 'secret-client', refreshToken: 'refresh-1' };
const SECRETS = [CREDS.clientSecret, CREDS.refreshToken];

/** One recorded fetch call. */
interface Call {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: unknown;
}

/** A fake YouTube: token, upload init, and the PUT, each answering like the real endpoint. */
function fakeYouTube(options: { tokenStatus?: number; initStatus?: number; putStatus?: number; id?: string } = {}) {
    const calls: Call[] = [];
    const fetchImpl = (async (input: string, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
            headers[key.toLowerCase()] = value;
        }
        const call: Call = { url, method: init?.method ?? 'GET', headers };
        if (typeof init?.body === 'string') call.body = init.body;
        calls.push(call);

        if (url === YOUTUBE_TOKEN_URL) {
            return new Response(JSON.stringify({ access_token: 'access-1', expires_in: 3600 }), {
                status: options.tokenStatus ?? 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        if (url === YOUTUBE_UPLOAD_URL) {
            return new Response('{}', {
                status: options.initStatus ?? 200,
                headers: { Location: 'https://upload.example/session/1' },
            });
        }
        if (url === 'https://upload.example/session/1') {
            return new Response(JSON.stringify({ id: options.id ?? 'shorts-abc123' }), {
                status: options.putStatus ?? 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        return new Response('unexpected', { status: 500 });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
}

/** A real temp MP4 file so the file ladder is exercised without mocks. */
function makeVideo(name = 'clip.mp4', bytes = 'mp4-bytes'): string {
    const dir = mkdtempSync(join(tmpdir(), 'kk-youtube-pub-'));
    const path = join(dir, name);
    writeFileSync(path, bytes);
    return path;
}

function makeContent(overrides: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}) {
    const videoPath = (overrides.videoPath as string | undefined) ?? makeVideo();
    return videoGenContentSchema.parse({
        title: overrides.title ?? '每日 AI 日报 1126',
        body: overrides.body ?? '今天的头条：推理模型上新。',
        format: 'video',
        metadata: {
            generator: 'kk:video-gen',
            videoPath,
            coverPath: '/tmp/cover.png',
            width: 1080,
            height: 1920,
            fps: 30,
            durationSec: 52,
            visualMode: 'editorial',
            renderProvider: 'local-ken-burns',
            tags: ['ai', 'daily'],
            ...metadata,
        },
    });
}

describe('youtube-pub upload (AC1)', () => {
    test('refreshes the token, opens a private resumable upload and reports the Shorts URL', async () => {
        const { calls, fetchImpl } = fakeYouTube();
        const client = new YouTubeClient({ fetchImpl, credentials: CREDS });

        const result = await client.publish(makeContent());

        expect(result.ok).toBe(true);
        expect(result.target).toBe('youtube-pub');
        expect(result.id).toBe('shorts-abc123');
        expect(result.url).toBe(shortsUrl('shorts-abc123'));
        expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
            `POST ${YOUTUBE_TOKEN_URL}`,
            `POST ${YOUTUBE_UPLOAD_URL}`,
            'PUT https://upload.example/session/1',
        ]);
        // Refresh-token grant, not an implicit/public path.
        expect(String(calls[0]?.body)).toContain('grant_type=refresh_token');
        expect(calls[1]?.headers.authorization).toBe('Bearer access-1');
        expect(calls[1]?.headers['x-upload-content-type']).toBe('video/mp4');
        const init = JSON.parse(String(calls[1]?.body)) as {
            snippet: { title: string; description: string; tags?: string[] };
            status: { privacyStatus: string; selfDeclaredMadeForKids: boolean };
        };
        expect(init.status.privacyStatus).toBe('private');
        expect(init.status.selfDeclaredMadeForKids).toBe(false);
        expect(init.snippet.title).toBe('每日 AI 日报 1126');
        expect(init.snippet.description).toContain('#Shorts');
        expect(init.snippet.tags).toEqual(['ai', 'daily']);
        expect(calls[2]?.headers['content-type']).toBe('video/mp4');
    });

    test('declares status.containsSyntheticMedia for a synthetic presenter (0452 R6)', async () => {
        const { calls, fetchImpl } = fakeYouTube();
        const content = makeContent({}, { syntheticPresenter: true });
        const result = await new YouTubeClient({ fetchImpl, credentials: CREDS }).publish(content);
        expect(result.ok).toBe(true);
        expect(JSON.parse(String(calls[1]?.body)).status.containsSyntheticMedia).toBe(true);

        // An ordinary editorial reel leaves the flag off.
        const plain = fakeYouTube();
        await new YouTubeClient({ fetchImpl: plain.fetchImpl, credentials: CREDS }).publish(makeContent());
        expect(JSON.parse(String(plain.calls[1]?.body)).status.containsSyntheticMedia).toBeUndefined();
    });

    test('honours an explicit unlisted/public override and refuses an unknown one', async () => {
        const unlisted = fakeYouTube();
        const allowed = await new YouTubeClient({ fetchImpl: unlisted.fetchImpl, credentials: CREDS }).publish(
            makeContent(),
            { privacyStatus: 'unlisted' },
        );
        expect(allowed.ok).toBe(true);
        expect(JSON.parse(String(unlisted.calls[1]?.body)).status.privacyStatus).toBe('unlisted');

        const refused = fakeYouTube();
        const result = await new YouTubeClient({ fetchImpl: refused.fetchImpl, credentials: CREDS }).publish(
            makeContent(),
            { privacyStatus: 'friends' },
        );
        expect(result.ok).toBe(false);
        expect(result.error).toContain('privacyStatus');
        expect(refused.calls).toHaveLength(0);
    });

    test('a metadata.privacyStatus key cannot override the private default (only options decides)', async () => {
        const { calls, fetchImpl } = fakeYouTube();
        // R4: the documented switch is `options.privacyStatus`. A loose metadata key must not flip
        // a safety default — the upload stays private.
        const content = makeContent({}, { privacyStatus: 'public' });
        const result = await new YouTubeClient({ fetchImpl, credentials: CREDS }).publish(content);
        expect(result.ok).toBe(true);
        expect(JSON.parse(String(calls[1]?.body)).status.privacyStatus).toBe('private');
    });

    test('reports an HTTP refusal from the token, init and PUT steps without leaking secrets', async () => {
        for (const options of [{ tokenStatus: 400 }, { initStatus: 403 }, { putStatus: 500 }]) {
            const { calls, fetchImpl } = fakeYouTube(options);
            const result = await new YouTubeClient({ fetchImpl, credentials: CREDS }).publish(makeContent());
            expect(result.ok).toBe(false);
            expect(result.error).toBeDefined();
            for (const secret of SECRETS) {
                expect(result.error).not.toContain(secret);
            }
            expect(calls.length).toBeGreaterThan(0);
        }
    });

    test('a 403 quota refusal names quotaExceeded and does not retry', async () => {
        const calls: string[] = [];
        const fetchImpl = (async (input: string) => {
            const url = String(input);
            calls.push(url);
            // The token step must succeed first; the quota refusal belongs to the upload init.
            if (url === YOUTUBE_TOKEN_URL) {
                return new Response(JSON.stringify({ access_token: 'access-1' }), { status: 200 });
            }
            return new Response('{"error":{"errors":[{"reason":"quotaExceeded"}]}}', { status: 403 });
        }) as unknown as typeof fetch;
        const result = await new YouTubeClient({ fetchImpl, credentials: CREDS }).publish(makeContent());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('quotaExceeded');
        expect(calls.filter((url) => url === YOUTUBE_UPLOAD_URL)).toHaveLength(1);
    });

    test('no secret appears in the Result or in a thrown message', async () => {
        const { fetchImpl } = fakeYouTube({ putStatus: 500 });
        const client = new YouTubeClient({ fetchImpl, credentials: CREDS });
        const result = await client.publish(makeContent());
        const serialized = JSON.stringify(result);
        for (const secret of SECRETS) {
            expect(serialized).not.toContain(secret);
        }
        expect(redact(`boom ${CREDS.refreshToken} ${CREDS.clientSecret}`, SECRETS)).toBe('boom *** ***');
    });
});

describe('youtube-pub fail-closed ladder (AC2)', () => {
    const refuse = async (content: ReturnType<typeof makeContent>, credentials = CREDS) => {
        const { calls, fetchImpl } = fakeYouTube();
        const result = await new YouTubeClient({ fetchImpl, credentials }).publish(content);
        expect(calls).toHaveLength(0);
        return result;
    };

    test('refuses a non-video Content, a landscape video, an over-long Short and a non-MP4 path', async () => {
        const notVideo = { ...makeContent(), format: 'markdown' } as unknown as ReturnType<typeof makeContent>;
        expect((await refuse(notVideo)).ok).toBe(false);

        const landscape = makeContent({}, { width: 1920, height: 1080 });
        expect((await refuse(landscape)).error).toContain('vertical 9:16');

        const tooLong = makeContent({}, { durationSec: 240 });
        expect((await refuse(tooLong)).error).toContain('at most 180s');

        const notMp4 = makeContent({ videoPath: makeVideo('clip.mov') });
        expect((await refuse(notMp4)).error).toContain('MP4 only');
    });

    test('refuses an unreadable video path and an over-long title', async () => {
        const missing = makeContent({ videoPath: join(tmpdir(), 'kk-absent-clip.mp4') });
        expect((await refuse(missing)).error).toContain('cannot read the video');

        const longTitle = makeContent({ title: 'x'.repeat(YOUTUBE_TITLE_MAX + 1) });
        expect((await refuse(longTitle)).error).toContain('YouTube accepts');
    });

    test('refuses missing credentials with an actionable message and no fetch', async () => {
        const { calls, fetchImpl } = fakeYouTube();
        const result = await new YouTubeClient({
            fetchImpl,
            env: {},
            home: join(tmpdir(), 'kk-youtube-home-absent'),
        }).publish(makeContent());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('youtube-pub needs OAuth2 credentials');
        expect(calls).toHaveLength(0);
    });
});

describe('credentials loader (R2/R3)', () => {
    test('env vars win over the file', () => {
        const loaded = loadYouTubeCredentials({
            env: {
                KK_YOUTUBE_CLIENT_ID: 'id',
                KK_YOUTUBE_CLIENT_SECRET: 'secret',
                KK_YOUTUBE_REFRESH_TOKEN: 'refresh',
            },
        });
        expect(loaded).toEqual({ credentials: { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' } });
    });

    test('reads a 0600 file, and refuses a wider mode or missing keys', () => {
        const home = mkdtempSync(join(tmpdir(), 'kk-youtube-home-'));
        const dir = join(home, '.config', 'kk');
        const path = credentialsFilePath(home);
        createNodeFileSystem();
        Bun.spawnSync(['mkdir', '-p', dir]);
        const writeFile = (mode: string, payload: Record<string, unknown>) => {
            writeFileSync(path, JSON.stringify(payload));
            Bun.spawnSync(['chmod', mode, path]);
        };

        writeFile('600', { client_id: 'id', client_secret: 'secret', refresh_token: 'refresh' });
        expect(loadYouTubeCredentials({ env: {}, home })).toEqual({
            credentials: { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' },
        });

        writeFile('644', { client_id: 'id', client_secret: 'secret', refresh_token: 'refresh' });
        const wide = loadYouTubeCredentials({ env: {}, home });
        expect('error' in wide && wide.error).toContain('must be 600');

        writeFile('600', { client_id: 'id' });
        const partial = loadYouTubeCredentials({ env: {}, home });
        expect('error' in partial && partial.error).toContain('missing client_secret, refresh_token');
    });
});

describe('upload helpers (R4/R5)', () => {
    test('description carries #Shorts exactly once', () => {
        expect(shortsDescription('正文')).toBe('正文\n\n#Shorts');
        expect(shortsDescription('正文 #shorts')).toBe('正文 #shorts');
        expect(shortsDescription('   ')).toBe('#Shorts');
    });

    test('upload deadline scales with the file and never drops below ten minutes', () => {
        expect(uploadTimeoutMs(1_000)).toBe(600_000);
        expect(uploadTimeoutMs(60_000_000)).toBeGreaterThan(600_000);
    });

    test('the init body carries the title, tags and the kids declaration', () => {
        const body = buildUploadBody({
            title: 't',
            description: 'd',
            privacyStatus: 'private',
        }) as { snippet: { tags?: string[] }; status: { selfDeclaredMadeForKids: boolean } };
        expect(body.snippet.tags).toBeUndefined();
        expect(body.status.selfDeclaredMadeForKids).toBe(false);
    });
});

describe('youtube-pub --in/--out contract (R1)', () => {
    const scratch = () => mkdtempSync(join(tmpdir(), 'kk-youtube-io-'));

    test('writes the Result JSON on success and exits 0 from main()', async () => {
        const dir = scratch();
        const inPath = join(dir, 'content.json');
        const outPath = join(dir, 'result.json');
        writeFileSync(inPath, JSON.stringify(makeContent()));
        const { fetchImpl } = fakeYouTube();

        await processPublishIO(inPath, outPath, { fetchImpl, credentials: CREDS });

        const written = JSON.parse(readFileSync(outPath, 'utf-8')) as { ok: boolean; url: string };
        expect(written.ok).toBe(true);
        expect(written.url).toBe(shortsUrl('shorts-abc123'));
    });

    test('a refused upload writes ok:false and throws, so kk publish exits nonzero', async () => {
        const dir = scratch();
        const inPath = join(dir, 'content.json');
        const outPath = join(dir, 'result.json');
        writeFileSync(inPath, JSON.stringify(makeContent({}, { width: 1920, height: 1080 })));
        const { fetchImpl, calls } = fakeYouTube();

        await expect(processPublishIO(inPath, outPath, { fetchImpl, credentials: CREDS })).rejects.toThrow(
            /vertical 9:16/,
        );
        const written = JSON.parse(readFileSync(outPath, 'utf-8')) as { ok: boolean; error: string };
        expect(written.ok).toBe(false);
        expect(written.error).toContain('vertical 9:16');
        expect(calls).toHaveLength(0);
    });

    test('an unparseable Content file is refused before any client work', async () => {
        const dir = scratch();
        const inPath = join(dir, 'content.json');
        const outPath = join(dir, 'result.json');
        writeFileSync(inPath, 'not json');
        await expect(processPublishIO(inPath, outPath, { credentials: CREDS })).rejects.toThrow(/Invalid Content/);
        const written = JSON.parse(readFileSync(outPath, 'utf-8')) as { ok: boolean; error: string };
        expect(written.error).toContain('Invalid Content input');
    });

    test('main() uploads through the injected seam (0) and refuses a bad payload (1)', async () => {
        const dir = scratch();
        const inPath = join(dir, 'content.json');
        const outPath = join(dir, 'result.json');
        const { fetchImpl } = fakeYouTube();
        // `options.privacyStatus` rides the Content JSON exactly as the publish matrix writes it.
        writeFileSync(inPath, JSON.stringify({ ...makeContent(), options: { privacyStatus: 'unlisted' } }));
        expect(await main(['--in', inPath, '--out', outPath], { fetchImpl, credentials: CREDS })).toBe(0);

        const badPath = join(dir, 'bad.json');
        writeFileSync(badPath, JSON.stringify({ title: 't', body: 'b', format: 'markdown', metadata: {} }));
        expect(await main(['--in', badPath, '--out', outPath], { fetchImpl, credentials: CREDS })).toBe(1);
    });

    test('main() refuses missing arguments and an unknown flag with exit 1', async () => {
        expect(await main([])).toBe(1);
        expect(await main(['--in', 'only-in.json'])).toBe(1);
        expect(await main(['--nope', 'x'])).toBe(1);
    });
});

describe('credentials loader edge cases (R3)', () => {
    test('refuses a directory at the credentials path and unreadable JSON', () => {
        const home = mkdtempSync(join(tmpdir(), 'kk-youtube-home-'));
        const dir = join(home, '.config', 'kk');
        Bun.spawnSync(['mkdir', '-p', join(dir, 'youtube-oauth.json')]);
        const asDir = loadYouTubeCredentials({ env: {}, home });
        expect('error' in asDir && asDir.error).toContain('not a regular file');

        Bun.spawnSync(['rm', '-rf', join(dir, 'youtube-oauth.json')]);
        writeFileSync(join(dir, 'youtube-oauth.json'), 'not json');
        Bun.spawnSync(['chmod', '600', join(dir, 'youtube-oauth.json')]);
        const badJson = loadYouTubeCredentials({ env: {}, home });
        expect('error' in badJson && badJson.error).toContain('not readable JSON');
    });
});
