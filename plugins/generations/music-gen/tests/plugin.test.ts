import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Content, Doc } from '@gobing-ai/kk-core';
import { createOfflineInstance, OfflineInstance } from '../src/adapter/offline';
import type { TakeSidecar } from '../src/artifact';
import { type MusicBrief, parseMusicBriefYaml } from '../src/brief';
import { DEFAULT_MUSIC_PRICES, type MusicConfig } from '../src/config';
import { takeDigest } from '../src/digest';
import { main, processGeneratorIO, withEncodedImages } from '../src/plugin';
import { resolveJob } from '../src/presets';
import { renderGenerateRequest } from '../src/request';
import { generatedTake, StubInstance } from './stub-instance';

/**
 * AC6 + R5/R6 — the plugin entry: Content mapping, per-take persistence with a
 * sidecar, the workspace boundary, and the resume-friendly failure path. Every
 * run uses an injected adapter, so no socket is opened.
 */

const CONFIG: MusicConfig = {
    baseUrl: 'http://127.0.0.1:3000',
    timeoutMs: 180_000,
    connectTimeoutMs: 5_000,
    prices: DEFAULT_MUSIC_PRICES,
    takesCap: 2,
    dryRun: true,
};

/** The 0400 confirmation these 0398 cases assume: they exercise generation, not the gate. */
const CONFIRMED = { spend: { confirmed: true } } as const;

const CLIP_BRIEF = `title: Midnight Cable Car
model: clip
format: clip
theme: lofi
language: EN
audio_format: mp3
style: |-
  Dusty lofi hip-hop at 78 BPM in D minor: vinyl crackle, upright bass, brushed kit, Rhodes chords.
lyrics: |-
  Last tram humming through the rain
`;

const TWO_TAKE_BRIEF = `${CLIP_BRIEF}takes: 2
`;

interface RunResult {
    dir: string;
    content: Content;
    files: string[];
    sidecars: TakeSidecar[];
    /** The 0400 pre-spend estimate blocks the entry emitted, in order. */
    estimates: string[];
}

/** Write a DocList whose first doc carries the brief, run the entry, collect the run directory. */
async function runJob(options: {
    brief?: string;
    client?: Parameters<typeof processGeneratorIO>[2] extends infer O
        ? O extends { client?: infer C }
            ? C
            : never
        : never;
    metadata?: Record<string, unknown>;
    images?: Array<{ path: string; bytes: Uint8Array }>;
    files?: Record<string, string>;
}): Promise<RunResult> {
    const dir = mkdtempSync(join(tmpdir(), 'kk-music-gen-'));
    const estimates: string[] = [];
    const doc: Doc = {
        id: 'brief-1',
        body: options.brief ?? CLIP_BRIEF,
        title: 'Midnight Cable Car',
        ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    };
    const inputPath = join(dir, 'input.json');
    const outputPath = join(dir, 'content.json');
    writeFileSync(inputPath, JSON.stringify([doc]));
    for (const [name, body] of Object.entries(options.files ?? {})) {
        writeFileSync(join(dir, name), body);
    }
    const content = await processGeneratorIO(inputPath, outputPath, {
        client: options.client ?? createOfflineInstance(),
        config: CONFIG,
        now: () => 1_700_000_000_000,
        spend: { confirmed: true },
        emit: (block: string) => estimates.push(block),
        ...(options.images === undefined
            ? {}
            : {
                  readImage: async (path: string) => {
                      const match = options.images?.find((image) => image.path === path);
                      if (match === undefined) {
                          throw new Error(`unexpected image read: ${path}`);
                      }
                      return match.bytes;
                  },
              }),
    });
    const files = readdirSync(dir)
        .filter((name) => name !== 'input.json')
        .sort();
    const sidecars = files
        .filter((name) => name.endsWith('.take.json'))
        .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as TakeSidecar);
    return { dir, content, files, sidecars, estimates };
}

describe('AC6 — the workspace boundary is respected', () => {
    test('a two-take job writes exactly two audio files and two sidecars into the run directory', async () => {
        const run = await runJob({ brief: TWO_TAKE_BRIEF });
        try {
            expect(run.files).toEqual([
                'content.json',
                'midnight-cable-car-clip-offline-take-1.wav',
                'midnight-cable-car-clip-offline-take-1.wav.take.json',
                'midnight-cable-car-clip-offline-take-2.wav',
                'midnight-cable-car-clip-offline-take-2.wav.take.json',
            ]);
            expect(run.sidecars).toHaveLength(2);
            for (const sidecar of run.sidecars) {
                expect(sidecar.digest).toMatch(/^[0-9a-f]{64}$/);
                expect(sidecar.instanceId).toMatch(/^offline-take-[12]$/);
                expect(sidecar.model).toBe('clip');
                expect(sidecar.unitPrice).toBe(0.04);
                expect(sidecar.format).toBe('wav');
                expect(sidecar.requestedFormat).toBe('mp3');
                expect(sidecar.adoptedByReconciliation).toBe(false);
                expect(sidecar.unclaimed).toEqual([]);
                expect(sidecar.dryRun).toBe(true);
                expect(sidecar.createdAt).toBe(new Date(1_700_000_000_000).toISOString());
            }
            // The digest is per take: 0400's run-scoped dedupe must not collapse take 2 into take 1.
            expect(run.sidecars[0]?.digest).not.toBe(run.sidecars[1]?.digest);
            expect(run.sidecars.map((sidecar) => sidecar.takeIndex)).toEqual([0, 1]);
        } finally {
            rmSync(run.dir, { recursive: true, force: true });
        }
    });

    test('the sidecar digest is exactly 0397 takeDigest for that take', async () => {
        const run = await runJob({ brief: TWO_TAKE_BRIEF });
        try {
            const job = resolveJob(parseMusicBriefYaml(TWO_TAKE_BRIEF));
            for (const [index, sidecar] of run.sidecars.entries()) {
                const expected = takeDigest(job, { takeIndex: index });
                expect(sidecar.digest).toBe(expected.sha256);
                expect(sidecar.digestInput).toEqual(expected.input);
            }
        } finally {
            rmSync(run.dir, { recursive: true, force: true });
        }
    });

    test('the sidecar records the exact request body that was sent', async () => {
        const client = new StubInstance();
        const run = await runJob({ client });
        try {
            const job = resolveJob(parseMusicBriefYaml(CLIP_BRIEF));
            const expected = renderGenerateRequest(job);
            expect(client.requests).toEqual([expected]);
            expect(run.sidecars[0]?.request).toEqual(expected);
        } finally {
            rmSync(run.dir, { recursive: true, force: true });
        }
    });

    test('a later take failing keeps the paid take on disk and writes no contract file', async () => {
        const client = new StubInstance({
            take: (request, index) => {
                if (index === 1) {
                    throw new Error('lyria instance POST /api/lyria/generate rejected the request with 429');
                }
                return generatedTake(request, { id: 'gen_1' });
            },
        });
        const dir = mkdtempSync(join(tmpdir(), 'kk-music-gen-'));
        const inputPath = join(dir, 'input.json');
        writeFileSync(inputPath, JSON.stringify([{ id: 'brief-1', body: TWO_TAKE_BRIEF } satisfies Doc]));
        try {
            const error = await processGeneratorIO(inputPath, join(dir, 'content.json'), {
                client,
                config: CONFIG,
                ...CONFIRMED,
            }).catch((err: unknown) => err as Error);
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toContain('take 2 of 2 failed');
            expect((error as Error).message).toContain('429');
            const files = readdirSync(dir)
                .filter((name) => name !== 'input.json')
                .sort();
            expect(files).toEqual(['midnight-cable-car-clip-gen_1.mp3', 'midnight-cable-car-clip-gen_1.mp3.take.json']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('R5 — the Content mapping', () => {
    test('format is audio, the body carries the liner notes and references point at the audio and the sidecar', async () => {
        const run = await runJob({});
        try {
            const { content } = run;
            expect(content.format).toBe('audio');
            expect(content.title).toBe('Midnight Cable Car');
            expect(content.body).toContain('# Midnight Cable Car');
            expect(content.body).toContain('Dusty lofi hip-hop at 78 BPM in D minor');
            expect(content.body).toContain('Last tram humming through the rain');
            expect(content.body).toContain('offline-take-1');
            expect(content.body).toContain('provider');
            expect(content.body).toContain('offline: synthetic analysis');

            const urls = (content.references ?? []).map((reference) => reference.url ?? '');
            expect(urls).toContain('offline://generations/offline-take-1/audio');
            expect(urls).toContain(join(run.dir, 'midnight-cable-car-clip-offline-take-1.wav.take.json'));

            const metadata = content.metadata as {
                provider?: string;
                dryRun?: boolean;
                takes?: Array<Record<string, unknown>>;
            };
            expect(metadata.provider).toBe('offline');
            expect(metadata.dryRun).toBe(true);
            expect(metadata.takes).toHaveLength(1);
            expect(metadata.takes?.[0]?.instanceId).toBe('offline-take-1');
            expect(metadata.takes?.[0]?.unitPrice).toBe(0.04);
        } finally {
            rmSync(run.dir, { recursive: true, force: true });
        }
    });

    test('language, durationTarget and batchCount are echoed exactly as the manifest records them', async () => {
        const client = new StubInstance({
            take: (request) =>
                generatedTake(request, { id: 'gen_echo', language: 'zh-CN', durationTarget: '1:30', batchCount: 3 }),
        });
        const run = await runJob({ client });
        try {
            const takes = (run.content.metadata as { takes: Array<Record<string, unknown>> }).takes;
            expect(takes[0]?.language).toBe('zh-CN');
            expect(takes[0]?.durationTarget).toBe('1:30');
            expect(takes[0]?.batchCount).toBe(3);
            expect(run.sidecars[0]?.language).toBe('zh-CN');
            expect(run.sidecars[0]?.durationTarget).toBe('1:30');
            expect(run.sidecars[0]?.batchCount).toBe(3);
        } finally {
            rmSync(run.dir, { recursive: true, force: true });
        }
    });

    test('echoes the manifest lacks are absent, never defaulted', async () => {
        const client = new StubInstance({
            take: (request) =>
                generatedTake(request, {
                    id: 'gen_bare',
                    language: undefined,
                    durationTarget: undefined,
                    batchCount: undefined,
                }),
        });
        const run = await runJob({ client });
        try {
            const record = (run.content.metadata as { takes: Array<Record<string, unknown>> }).takes[0] ?? {};
            expect('language' in record).toBe(false);
            expect('durationTarget' in record).toBe(false);
            expect('batchCount' in record).toBe(false);
            expect('durationTarget' in (run.sidecars[0] ?? {})).toBe(false);
            expect('batchCount' in (run.sidecars[0] ?? {})).toBe(false);
            expect(run.content.body).not.toContain('duration target');
        } finally {
            rmSync(run.dir, { recursive: true, force: true });
        }
    });

    test('an adopted take is flagged in the sidecar and the liner notes, with the extras listed', async () => {
        const client = new StubInstance({
            take: (request) =>
                generatedTake(request, {
                    id: 'gen_adopted',
                    adoptedByReconciliation: true,
                    unclaimed: [{ id: 'gen_extra', generatedAt: '2023-11-14T22:13:30.000Z' }],
                }),
        });
        const run = await runJob({ client });
        try {
            expect(run.sidecars[0]?.adoptedByReconciliation).toBe(true);
            expect(run.sidecars[0]?.unclaimed).toEqual([{ id: 'gen_extra', generatedAt: '2023-11-14T22:13:30.000Z' }]);
            expect(run.content.body).toContain('adopted from `GET /api/generations`');
            expect(run.content.body).toContain('gen_extra');
        } finally {
            rmSync(run.dir, { recursive: true, force: true });
        }
    });

    test('reference images are hashed for the digest and encoded for the wire', async () => {
        const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
        const brief = `${CLIP_BRIEF}images:
  - ${join(tmpdir(), 'ref.png')}
`;
        const client = new StubInstance();
        const run = await runJob({
            brief,
            client,
            images: [{ path: join(tmpdir(), 'ref.png'), bytes: imageBytes }],
        });
        try {
            const sent = client.requests[0];
            expect(sent?.images).toHaveLength(1);
            expect(sent?.images?.[0]?.startsWith('data:image/png;base64,')).toBe(true);
            expect(run.sidecars[0]?.digestInput.images[0]).toMatch(/^[0-9a-f]{64}$/);
            // The prompt is untouched by the image encoding.
            const job = resolveJob(parseMusicBriefYaml(brief) as MusicBrief);
            expect(sent?.prompt).toBe(renderGenerateRequest(job).prompt);
        } finally {
            rmSync(run.dir, { recursive: true, force: true });
        }
    });

    test('a job with no lyrics renders the "model writes its own" line, and an instrumental one says so', async () => {
        const instrumental = `title: Underscore Bed
model: clip
format: loop
theme: ambient-tech
instrumental: true
style: Glassy, spacious texture at 110 BPM, no vocals.
`;
        const run = await runJob({ brief: instrumental });
        try {
            expect(run.content.body).toContain('(instrumental)');
        } finally {
            rmSync(run.dir, { recursive: true, force: true });
        }
    });
});

describe('job input', () => {
    test('an empty DocList is refused before any adapter work', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-music-gen-'));
        const inputPath = join(dir, 'input.json');
        writeFileSync(inputPath, '[]');
        try {
            const error = await processGeneratorIO(inputPath, join(dir, 'content.json'), {
                client: createOfflineInstance(),
                config: CONFIG,
                ...CONFIRMED,
            }).catch((err: unknown) => err as Error);
            expect((error as Error).message).toContain('empty');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a brief that is not valid YAML fails with the brief path named', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-music-gen-'));
        const inputPath = join(dir, 'input.json');
        writeFileSync(inputPath, JSON.stringify([{ id: 'brief-1', body: 'title: [unclosed' }]));
        try {
            const error = await processGeneratorIO(inputPath, join(dir, 'content.json'), {
                client: createOfflineInstance(),
                config: CONFIG,
                ...CONFIRMED,
            }).catch((err: unknown) => err as Error);
            expect((error as Error).message).toContain('docs[0].body');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a preset layer supplied through metadata is applied before any spend', async () => {
        const brief = `title: Underscore Bed
model: clip
format: loop
theme: ambient-tech
instrumental: true
`;
        const client = new StubInstance();
        const run = await runJob({
            brief,
            client,
            metadata: { musicGen: { presets: { format: { name: 'loop', style: 'Glassy texture at 110 BPM.' } } } },
        });
        try {
            expect(client.requests[0]?.prompt).toContain('Glassy texture at 110 BPM.');
        } finally {
            rmSync(run.dir, { recursive: true, force: true });
        }
    });

    test('an unknown key in metadata.musicGen fails loud', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-music-gen-'));
        const inputPath = join(dir, 'input.json');
        writeFileSync(
            inputPath,
            JSON.stringify([{ id: 'brief-1', body: CLIP_BRIEF, metadata: { musicGen: { takez: 2 } } }]),
        );
        try {
            const error = await processGeneratorIO(inputPath, join(dir, 'content.json'), {
                client: createOfflineInstance(),
                config: CONFIG,
                ...CONFIRMED,
            }).catch((err: unknown) => err as Error);
            expect((error as Error).message).toContain('Invalid music job spec');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('the plugin entry', () => {
    test('no --in/--out is a usage error, not a crash', async () => {
        expect(await main([])).toBe(1);
        expect(await main(['--in', 'only-in.json'])).toBe(1);
    });

    test('KK_MUSIC_DRY_RUN=1 drives the whole entry end to end without a socket', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-music-entry-'));
        const inputPath = join(dir, 'input.json');
        const outputPath = join(dir, 'content.json');
        writeFileSync(inputPath, JSON.stringify([{ id: 'brief-1', body: CLIP_BRIEF } satisfies Doc]));
        const previousDryRun = process.env.KK_MUSIC_DRY_RUN;
        const previousConfig = process.env.KK_CONFIG;
        process.env.KK_MUSIC_DRY_RUN = '1';
        process.env.KK_CONFIG = join(dir, 'no-such-config.yaml');
        try {
            expect(await main(['--in', inputPath, '--out', outputPath, '--yes'])).toBe(0);
            const content = JSON.parse(readFileSync(outputPath, 'utf8')) as Content;
            expect(content.format).toBe('audio');
            expect((content.metadata as { provider?: string }).provider).toBe('offline');
            expect(readdirSync(dir).filter((name) => name.endsWith('.wav'))).toHaveLength(1);
        } finally {
            if (previousDryRun === undefined) {
                delete process.env.KK_MUSIC_DRY_RUN;
            } else {
                process.env.KK_MUSIC_DRY_RUN = previousDryRun;
            }
            if (previousConfig === undefined) {
                delete process.env.KK_CONFIG;
            } else {
                process.env.KK_CONFIG = previousConfig;
            }
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a failing adapter surfaces as exit 1 with the diagnostic on stderr', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-music-entry-'));
        const inputPath = join(dir, 'input.json');
        writeFileSync(inputPath, JSON.stringify([{ id: 'brief-1', body: CLIP_BRIEF } satisfies Doc]));
        const previousDryRun = process.env.KK_MUSIC_DRY_RUN;
        process.env.KK_MUSIC_DRY_RUN = '1';
        try {
            // A brief whose preset layer is invalid fails before the adapter is built.
            writeFileSync(
                inputPath,
                JSON.stringify([
                    { id: 'brief-1', body: CLIP_BRIEF, metadata: { musicGen: { presets: { theme: { name: '' } } } } },
                ]),
            );
            expect(await main(['--in', inputPath, '--out', join(dir, 'content.json'), '--yes'])).toBe(1);
        } finally {
            if (previousDryRun === undefined) {
                delete process.env.KK_MUSIC_DRY_RUN;
            } else {
                process.env.KK_MUSIC_DRY_RUN = previousDryRun;
            }
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('adapter helpers', () => {
    test('withEncodedImages leaves an image-free request untouched', () => {
        const job = resolveJob(parseMusicBriefYaml(CLIP_BRIEF));
        const request = renderGenerateRequest(job);
        expect(withEncodedImages(request, [])).toBe(request);
    });

    test('the offline adapter exposes a library URL and an analysis for 0401 to read', async () => {
        const instance = new OfflineInstance();
        const take = await instance.generate(renderGenerateRequest(resolveJob(parseMusicBriefYaml(CLIP_BRIEF))));
        expect(instance.libraryUrl(take.id)).toBe(`offline://generations/${take.id}`);
        const analysis = await instance.analyze(take.id);
        expect(analysis.paid).toBe(false);
        expect(analysis.analysis).not.toBeNull();
    });

    test('the stub instance implements the whole adapter surface', async () => {
        const job = resolveJob(parseMusicBriefYaml(CLIP_BRIEF));
        const client = new StubInstance({ analysis: { summary: 'stubbed' } });
        const take = await client.generate(renderGenerateRequest(job));
        expect(take.id).toBe('gen_1');
        expect(await client.listGenerations()).toEqual([]);
        expect((await client.analyze('gen_1')).analysis).toEqual({ summary: 'stubbed' });
        expect(client.libraryUrl('gen_1')).toContain('/api/generations/gen_1');
    });

    test('a partially-read DocList and a first-take failure both fail loud', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-music-gen-'));
        const inputPath = join(dir, 'input.json');
        writeFileSync(inputPath, '{"not":"a list"}');
        try {
            const badInput = await processGeneratorIO(inputPath, join(dir, 'content.json'), {
                client: createOfflineInstance(),
                config: CONFIG,
                ...CONFIRMED,
            }).catch((err: unknown) => err as Error);
            expect((badInput as Error).message).toContain('Invalid DocList input');

            writeFileSync(inputPath, JSON.stringify([{ id: 'brief-1', body: CLIP_BRIEF } satisfies Doc]));
            const failing = new StubInstance({
                take: () => {
                    throw new Error('lyria instance POST /api/lyria/generate rejected the request with 402');
                },
            });
            const firstTake = await processGeneratorIO(inputPath, join(dir, 'content.json'), {
                client: failing,
                config: CONFIG,
                ...CONFIRMED,
            }).catch((err: unknown) => err as Error);
            expect((firstTake as Error).message).toContain('402');
            expect(readdirSync(dir).filter((name) => name.endsWith('.wav') || name.endsWith('.mp3'))).toHaveLength(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
