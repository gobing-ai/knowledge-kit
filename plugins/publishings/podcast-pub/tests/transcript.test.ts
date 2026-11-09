import { describe, expect, spyOn, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Content, type Result, ResultSchema } from '@gobing-ai/kk-core';
import { PodcastPubTransport } from '../src/index';
import {
    buildTranscriptSegments,
    renderSrt,
    renderWebVtt,
    resolveTranscriptConfig,
    type TranscriptConfig,
    type TranscriptSegmentInput,
    transcriptReferences,
} from '../src/transcript';

const HOSTED_URL = 'https://cdn.example.com/podcasts/20260924.vtt';

/** Narrows the union so `.error` reads are type-safe in these tests. */
function configError(result: { config: TranscriptConfig } | { error: string }): string {
    return 'error' in result ? result.error : '';
}

/** The union's config arm, narrowed for value assertions. */
function configOf(result: { config: TranscriptConfig } | { error: string }): TranscriptConfig {
    if ('error' in result) throw new Error(`unexpected config error: ${result.error}`);
    return result.config;
}

/**
 * Today's real data: per-clip durations + ASR transcriptions, NO measured absolute offsets —
 * the transcript must be inert for exactly this shape (docs §3/§4).
 */
const SEGMENTS: Array<{ duration: number; transcription: string }> = [
    { duration: 10, transcription: '大家好，欢迎收听。' },
    { duration: 20.5, transcription: '先看第一条。' },
];

/**
 * Future-shaped data: measured absolute offsets recorded against the final mixed episode —
 * 8 s intro sting and the 1.5 s gap live inside the offsets, plus per-clip `duration` noise
 * that the builder must ignore.
 */
const measured: Array<TranscriptSegmentInput & { duration: number }> = [
    { startSeconds: 8, duration: 1, transcription: '大家好，欢迎收听。' },
    { startSeconds: 30.5, duration: 1, transcription: '先看第一条。' },
    { startSeconds: 60.1, endSeconds: 61.4, duration: 1, transcription: '今天的第一条。' },
];

/** The 2-cue happy-path shape for gating tests (last cue ends exactly at its own endSeconds). */
const valid: TranscriptSegmentInput[] = [
    { startSeconds: 8, transcription: '大家好，欢迎收听。' },
    { startSeconds: 30.5, endSeconds: 60, transcription: '先看第一条。' },
];

interface CapturedRequest {
    url: string;
    method: string;
    body?: unknown;
}

interface TwoPhaseCapture {
    requests: CapturedRequest[];
    updateBody: unknown;
    result: Result;
}

/**
 * Runs the real `publish` op against a scripted offline fake API (same pattern as
 * podcast-pub.test.ts): two-phase audio upload, capturing every request body.
 * Sets the given env keys and restores whatever they were.
 */
async function runPublishFlow(input: {
    content: Content;
    env: Record<string, string | undefined>;
    countFetch?: (seen: number) => void;
}): Promise<{ capture: TwoPhaseCapture; fetchCount: () => number }> {
    const keys = ['MICROFEED_BASE_URL', 'MICROFEED_API_KEY', 'PODCAST_PUB_TRANSCRIPT', 'PODCAST_PUB_TRANSCRIPT_URL'];
    const saved: Record<string, string | undefined> = {};
    for (const key of keys) {
        saved[key] = process.env[key];
        if (input.env[key] === undefined) delete process.env[key];
        else process.env[key] = input.env[key];
    }
    const requests: CapturedRequest[] = [];
    let count = 0;
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
        fetchInput: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
    ) => {
        count += 1;
        const captured: CapturedRequest = {
            url: String(fetchInput),
            method: init?.method ?? 'GET',
            body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
        };
        requests.push(captured);
        const json = (payload: unknown, status = 200): Response =>
            new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
        if (init?.method === 'POST' && captured.url.endsWith('/api/v1/items')) return json({ id: 'mf-item-1' }, 201);
        if (init?.method === 'POST' && captured.url.endsWith('/api/v1/media_files/presigned_urls')) {
            return json({
                presigned_url: 'https://feed.example.com/presign/mf-item-1',
                media_url: 'https://media.example.com/media/audio/mf-item-1.wav',
            });
        }
        if (init?.method === 'PUT' && captured.url.includes('/presign/')) return json({});
        if (init?.method === 'PUT' && captured.url.endsWith('/api/v1/items/mf-item-1')) {
            return json({ id: 'mf-item-1', url: 'https://feed.example.com/items/ep-1', status: 'published' });
        }
        throw new Error(`fake API has no route for ${init?.method ?? 'GET'} ${captured.url}`);
    }) as unknown as typeof fetch);
    try {
        const result = ResultSchema.parse(await new PodcastPubTransport().publish({ content: input.content }));
        input.countFetch?.(count);
        const capturedUpdate = requests.find((r) => r.method === 'PUT' && r.url.endsWith('/api/v1/items/mf-item-1'));
        return {
            capture: { requests, updateBody: capturedUpdate?.body, result },
            fetchCount: () => count,
        };
    } finally {
        fetchSpy.mockRestore();
        for (const key of keys) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    }
}

describe('podcast-pub transcript cues (pure)', () => {
    test("starts are the segments' own measured offsets, never sums of per-clip durations", () => {
        const cues = buildTranscriptSegments(measured);
        // 8 (after the intro sting) / 30.5 / 60.1 — if durations were summed this would be 0/1/2.
        expect(cues?.map((c) => c.start)).toEqual([8, 30.5, 60.1]);
        // Every end is a measured boundary: the next recorded start, then the last endSeconds.
        expect(cues?.map((c) => c.end)).toEqual([30.5, 60.1, 61.4]);
        // Two-segment shape: last cue ends at its own measured endSeconds.
        expect(buildTranscriptSegments(valid)).toEqual([
            { start: 8, end: 30.5, text: '大家好，欢迎收听。' },
            { start: 30.5, end: 60, text: '先看第一条。' },
        ]);
    });

    test("today's real shape (per-clip durations, no offsets) is inert: no transcript", () => {
        expect(buildTranscriptSegments(SEGMENTS as TranscriptSegmentInput[])).toBeUndefined();
        expect(
            buildTranscriptSegments([
                { startSeconds: 0, transcription: 'first keeps a start' },
                { duration: 9, transcription: 'second has no startSeconds' },
            ] as TranscriptSegmentInput[]),
        ).toBeUndefined();
        expect(buildTranscriptSegments([] as TranscriptSegmentInput[])).toBeUndefined();
    });

    test('discards the transcript unless every startSeconds is a measured, finite, increasing offset', () => {
        expect(buildTranscriptSegments([{ startSeconds: -0.5, endSeconds: 1, transcription: 'x' }])).toBeUndefined();
        expect(
            buildTranscriptSegments([{ startSeconds: Number.POSITIVE_INFINITY, endSeconds: 5, transcription: 'x' }]),
        ).toBeUndefined();
        expect(
            buildTranscriptSegments([
                { startSeconds: '8' as unknown as number } as TranscriptSegmentInput & { endSeconds: number },
            ]),
        ).toBeUndefined();
        expect(buildTranscriptSegments([{ startSeconds: NaN, endSeconds: 9, transcription: 'x' }])).toBeUndefined();
        expect(
            buildTranscriptSegments([
                { startSeconds: 5, endSeconds: 9.5, transcription: 'first' },
                { startSeconds: 5, endSeconds: 9.5, transcription: 'equal offset ⇒ zero-length cue' },
            ]),
        ).toBeUndefined();
        expect(
            buildTranscriptSegments([
                { startSeconds: 5, endSeconds: 9.5, transcription: 'first' },
                { startSeconds: 1, endSeconds: 6, transcription: 'decreasing' },
            ]),
        ).toBeUndefined();
    });

    test('discards the transcript unless the LAST segment carries a measured endSeconds beyond its start', () => {
        expect(
            buildTranscriptSegments([
                { startSeconds: 8, transcription: 'first' },
                { startSeconds: 9.5, transcription: 'last cue goes to the boundary' },
            ]),
        ).toBeUndefined();
        expect(
            buildTranscriptSegments([
                { startSeconds: 8, transcription: 'first' },
                { startSeconds: 9.5, endSeconds: 9.4, transcription: 'end before start' },
            ]),
        ).toBeUndefined();
    });

    test('discards the transcript unless every transcription is non-empty', () => {
        expect(
            buildTranscriptSegments([...valid, { startSeconds: 88, endSeconds: 90, transcription: '' }]),
        ).toBeUndefined();
        expect(
            buildTranscriptSegments([...valid, { startSeconds: 88, endSeconds: 90, transcription: '   ' }]),
        ).toBeUndefined();
        expect(buildTranscriptSegments([...valid, { startSeconds: 88, endSeconds: 90 }])).toBeUndefined();
        expect(
            buildTranscriptSegments([
                ...valid,
                { startSeconds: 88, endSeconds: 90, transcription: 123 as unknown as string },
            ]),
        ).toBeUndefined();
    });

    test('renders WebVTT with a header and mixed-episode-coordinate HH:MM:SS.mmm stamps', () => {
        const vtt = renderWebVtt(buildTranscriptSegments(measured) ?? []);
        expect(vtt.startsWith('WEBVTT')).toBe(true);
        expect(vtt).toContain('00:00:08.000 --> 00:00:30.500\n大家好，欢迎收听。');
        expect(vtt).toContain('00:00:30.500 --> 00:01:00.100');
        expect(vtt).toContain('00:01:00.100 --> 00:01:01.400');
    });

    test('escapes &, < and > per WebVTT and drops CR characters', () => {
        const cues =
            buildTranscriptSegments([{ startSeconds: 1, endSeconds: 4, transcription: 'a < b & c > d\\r\\nTail' }]) ??
            [];
        expect(cues).toHaveLength(1);
        const vtt = renderWebVtt(cues);
        expect(vtt).toContain('a &lt; b &amp; c &gt; d');
        expect(vtt).not.toContain('\r');
    });

    test('renders the SubRip twin: numbered cues, comma separator, no header', () => {
        const srt = renderSrt([
            { start: 3610, end: 3611.25, text: 'late cue' },
            { start: 60, end: 61, text: 'early' },
        ]);
        expect(srt.startsWith('1\n')).toBe(true);
        expect(srt).toContain('01:00:10,000 --> 01:00:11,250\nlate cue');
        expect(srt).toContain('2\n00:01:00,000 --> 00:01:01,000\nearly');
        expect(srt).not.toContain('WEBVTT');
    });

    test('transcriptReferences carries only the microfeed 1.0.13-accepted VTT shape', () => {
        expect(transcriptReferences(HOSTED_URL)).toEqual([{ url: HOSTED_URL, type: 'text/vtt', language: 'zh-cn' }]);
    });
});

describe('podcast-pub transcript config', () => {
    test('off by default regardless of an env URL', () => {
        expect(configOf(resolveTranscriptConfig(undefined, { PODCAST_PUB_TRANSCRIPT_URL: HOSTED_URL }))).toEqual({
            enabled: false,
            url: HOSTED_URL,
        });
        expect(configOf(resolveTranscriptConfig({}))).toEqual({ enabled: false });
    });

    test('accepts the true/false spellings and fails loud on anything else', () => {
        for (const value of [true, 'true', '1'] as const) {
            expect(configOf(resolveTranscriptConfig({ podcast: { transcriptEnabled: value } }))).toEqual({
                enabled: true,
            });
        }
        for (const value of [false, 'false', '0'] as const) {
            expect(configOf(resolveTranscriptConfig({ podcast: { transcriptEnabled: value } }))).toEqual({
                enabled: false,
            });
        }
        expect(configError(resolveTranscriptConfig({ podcast: { transcriptEnabled: 'yes' } }))).toContain(
            'invalid transcript enable flag',
        );
        expect(configError(resolveTranscriptConfig(undefined, { PODCAST_PUB_TRANSCRIPT: 'yes' }))).toContain(
            'invalid transcript enable flag',
        );
    });

    test('metadata.podcast.* beats env', () => {
        expect(
            configOf(
                resolveTranscriptConfig(
                    { podcast: { transcriptEnabled: true, transcriptUrl: HOSTED_URL } },
                    { PODCAST_PUB_TRANSCRIPT: 'true' },
                ),
            ),
        ).toEqual({ enabled: true, url: HOSTED_URL });
        expect(
            configOf(
                resolveTranscriptConfig({ podcast: { transcriptUrl: HOSTED_URL } }, { PODCAST_PUB_TRANSCRIPT: 'true' }),
            ),
        ).toEqual({ enabled: true, url: HOSTED_URL });
    });

    test('a non-HTTPS URL fails loud; http URLs are never enough', () => {
        expect(
            configError(resolveTranscriptConfig({ podcast: { transcriptUrl: 'http://cdn.example.com/a.vtt' } })),
        ).toContain('microfeed hosts only HTTPS transcript files');
        expect(configError(resolveTranscriptConfig({ podcast: { transcriptUrl: '/tmp/a.vtt' } }))).toContain(
            'microfeed hosts only HTTPS',
        );
        expect(
            configError(resolveTranscriptConfig(undefined, { PODCAST_PUB_TRANSCRIPT_URL: 'http://x/vtt' })),
        ).toContain('microfeed hosts only HTTPS');
    });

    test('a non-string URL value and whitespace are handled', () => {
        expect(configOf(resolveTranscriptConfig({ podcast: { transcriptUrl: `  ${HOSTED_URL}  ` } }))).toEqual({
            enabled: false,
            url: HOSTED_URL,
        });
        expect(configError(resolveTranscriptConfig({ podcast: { transcriptUrl: 42 as unknown as string } }))).toContain(
            'microfeed hosts only HTTPS',
        );
    });
});

describe('podcast-pub publish wiring (PODCAST_PUB_TRANSCRIPT)', () => {
    const DIR = join(process.cwd(), '.works/tmp/test-podcast-transcript');
    const MP3 = join(DIR, 'episode-1.mp3');

    const contentWithSegments = (): Content => ({
        title: 'Episode 1: Ground Up',
        body: '# Episode 1: Ground Up\\n\\nShow notes body.',
        format: 'markdown',
        metadata: { audioFile: MP3, mp3Path: MP3, segments: SEGMENTS },
    });

    const setupDir = async (): Promise<void> => {
        await rm(DIR, { recursive: true, force: true });
        await mkdir(DIR, { recursive: true });
        await writeFile(MP3, new Uint8Array([1, 2, 3]));
    };

    test('transcript off (default): no _microfeed.podcast key in the final update and no .vtt on disk', async () => {
        await setupDir();
        const { capture } = await runPublishFlow({
            content: contentWithSegments(),
            env: { MICROFEED_BASE_URL: 'https://feed.example.com', MICROFEED_API_KEY: 'k' },
        });
        expect((capture.updateBody as Record<string, { podcast?: unknown }>).podcast).toBeUndefined();
        await expect(readFile(join(DIR, 'episode-1.vtt'), 'utf-8')).rejects.toThrow();
    });

    test("transcript on with today's shape: inert — warns, no .vtt, no transcripts in the payload", async () => {
        await setupDir();
        const { capture } = await runPublishFlow({
            content: contentWithSegments(),
            env: {
                MICROFEED_BASE_URL: 'https://feed.example.com',
                MICROFEED_API_KEY: 'k',
                PODCAST_PUB_TRANSCRIPT: 'true',
                PODCAST_PUB_TRANSCRIPT_URL: HOSTED_URL,
            },
        });
        expect(capture.result.ok).toBe(true);
        expect(JSON.stringify(capture.result.metadata?.warnings)).toContain('no measured absolute offsets');
        expect((capture.updateBody as Record<string, { podcast?: unknown }>).podcast).toBeUndefined();
        await expect(readFile(join(DIR, 'episode-1.vtt'), 'utf-8')).rejects.toThrow();
    });

    test('forward-compat: measured offsets in metadata flip the feature alive end to end', async () => {
        await setupDir();
        const forward = contentWithSegments();
        (forward.metadata as Record<string, unknown>).segments = measured;
        const { capture } = await runPublishFlow({
            content: forward,
            env: {
                MICROFEED_BASE_URL: 'https://feed.example.com',
                MICROFEED_API_KEY: 'k',
                PODCAST_PUB_TRANSCRIPT: 'true',
                PODCAST_PUB_TRANSCRIPT_URL: HOSTED_URL,
            },
        });
        const final = capture.updateBody as { _microfeed?: { podcast?: { transcripts?: unknown[] } } };
        expect(final._microfeed?.podcast?.transcripts).toEqual([
            { url: HOSTED_URL, type: 'text/vtt', language: 'zh-cn' },
        ]);
        const vtt = await readFile(join(DIR, 'episode-1.vtt'), 'utf-8');
        expect(vtt.startsWith('WEBVTT')).toBe(true);
        expect(vtt).toContain('00:00:08.000 --> 00:00:30.500');
        expect(vtt).toContain('大家好，欢迎收听。');
    });

    test('transcript on without a URL: warns and publishes without transcripts', async () => {
        await setupDir();
        const { capture } = await runPublishFlow({
            content: contentWithSegments(),
            env: {
                MICROFEED_BASE_URL: 'https://feed.example.com',
                MICROFEED_API_KEY: 'k',
                PODCAST_PUB_TRANSCRIPT: 'true',
            },
        });
        expect(JSON.stringify(capture.result.metadata?.warnings)).toContain('no transcriptUrl');
        expect((capture.updateBody as Record<string, { podcast?: unknown }>).podcast).toBeUndefined();
    });

    test('transcript on with an HTTP URL fails the publish loud with no request signed', async () => {
        await setupDir();
        let seen = -1;
        const { capture, fetchCount } = await runPublishFlow({
            content: contentWithSegments(),
            env: {
                MICROFEED_BASE_URL: 'https://feed.example.com',
                MICROFEED_API_KEY: 'k',
                PODCAST_PUB_TRANSCRIPT: 'true',
                PODCAST_PUB_TRANSCRIPT_URL: 'http://cdn.example.com/a.vtt',
            },
            countFetch: (n) => {
                seen = n;
            },
        });
        expect(capture.result.ok).toBe(false);
        expect(capture.result.error).toContain('microfeed hosts only HTTPS transcript files');
        expect(seen).toBe(0);
        expect(fetchCount()).toBe(0);
    });

    test('an unwritable artifact location disables the transcript without failing the publish', async () => {
        await setupDir();
        const badContent = contentWithSegments();
        (badContent.metadata as Record<string, unknown>).segments = measured;
        (badContent.metadata as Record<string, unknown>).mp3Path = join(DIR, 'nope', 'episode-1.mp3');
        const { capture } = await runPublishFlow({
            content: badContent,
            env: {
                MICROFEED_BASE_URL: 'https://feed.example.com',
                MICROFEED_API_KEY: 'k',
                PODCAST_PUB_TRANSCRIPT: 'true',
                PODCAST_PUB_TRANSCRIPT_URL: HOSTED_URL,
            },
        });
        expect(capture.result.ok).toBe(true);
        expect(JSON.stringify(capture.result.metadata?.warnings)).toContain('could not write');
        expect((capture.updateBody as Record<string, { podcast?: unknown }>).podcast).toBeUndefined();
    });

    test('no local mp3Path/audioPath/audioFile anchor: warn + no transcript, publish continues', async () => {
        await setupDir();
        const noAnchor = contentWithSegments();
        const meta = noAnchor.metadata as Record<string, unknown>;
        delete meta.mp3Path;
        meta.audioPath = 42;
        meta.audioFile = MP3;
        (noAnchor.metadata as Record<string, unknown>).segments = measured;
        const { capture } = await runPublishFlow({
            content: noAnchor,
            env: {
                MICROFEED_BASE_URL: 'https://feed.example.com',
                MICROFEED_API_KEY: 'k',
                PODCAST_PUB_TRANSCRIPT: 'true',
                PODCAST_PUB_TRANSCRIPT_URL: HOSTED_URL,
            },
        });
        expect(capture.result.ok).toBe(true);
        expect((capture.updateBody as Record<string, { podcast?: unknown }>).podcast).toBeUndefined();
    });

    test('non-audio content without segments: transcript on still publishes with no transcript (no crash)', async () => {
        await setupDir();
        const plain: Content = {
            title: 'Episode 2',
            body: 'No heading needed.',
            format: 'markdown',
            metadata: { audioUrl: 'https://cdn.example.com/ep2.mp3' },
        };
        const { capture } = await runPublishFlow({
            content: plain,
            env: {
                MICROFEED_BASE_URL: 'https://feed.example.com',
                MICROFEED_API_KEY: 'k',
                PODCAST_PUB_TRANSCRIPT: 'true',
                PODCAST_PUB_TRANSCRIPT_URL: HOSTED_URL,
            },
        });
        expect(capture.result.ok).toBe(true);
        const created = capture.requests.find((r) => r.method === 'POST' && r.url.endsWith('/api/v1/items'));
        expect((created?.body as Record<string, { podcast?: unknown }>)?.podcast).toBeUndefined();
    });
});
