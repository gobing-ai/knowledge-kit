import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PublishPresetSchema } from '../../../apps/cli/src/publish-core';
import { buildVideoVariant, dailyBundleVariants, dailyVideoRequest, isShortFormVariant } from '../scripts/daily-stages';

/**
 * 0449 R4 (AC1) — the video variants: a completed 32-video render becomes `video`,
 * `video@shipinhao-pub` and `video@xhs-pub` in the frozen bundle, the xhs copy carries the
 * `metadata.video` key its 上传视频 ladder reads, and a missing render is a recorded skip rather
 * than a crash.
 */

let logSpy: { mockRestore(): void; mock: { calls: unknown[][] } };
let errSpy: { mockRestore(): void };

beforeEach(() => {
    logSpy = spyOn(console, 'log').mockImplementation(() => {}) as unknown as typeof logSpy;
    errSpy = spyOn(console, 'error').mockImplementation(() => {}) as unknown as typeof errSpy;
});

afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
});

const STAMP = '20261126';
const VIDEO_CONTENT = {
    title: '每日 AI 日报 1126',
    body: '今天的头条：推理模型上新，开源权重登顶。',
    format: 'video',
    metadata: {
        generator: 'kk:video-gen',
        videoPath: '',
        coverPath: '',
        width: 1080,
        height: 1920,
        fps: 30,
        durationSec: 52,
        visualMode: 'editorial',
        renderProvider: 'local-ken-burns',
        tags: ['ai', 'daily'],
    },
};

/** A daily run with everything `dailyBundleVariants` reads, minus the video unless asked. */
function makeRun(options: { withRender?: boolean; contentFormat?: string } = {}): {
    dir: string;
    videoPath: string;
} {
    const dir = mkdtempSync(join(tmpdir(), 'kk-daily-video-'));
    for (const name of ['22-article', '25-xhs', '31-publish', '32-video']) {
        mkdirSync(join(dir, name), { recursive: true });
    }
    writeFileSync(
        join(dir, '22-article', `${STAMP}_06_article_content.json`),
        JSON.stringify({ title: '第261126期 · AI 日报', body: '正文', format: 'markdown', metadata: {} }),
    );
    writeFileSync(
        join(dir, '31-publish', `${STAMP}_13_publish-prep_content.json`),
        JSON.stringify({ title: '第261126期', body: '口播', format: 'text', metadata: { audioFile: '/tmp/a.mp3' } }),
    );
    writeFileSync(
        join(dir, '25-xhs', 'content.json'),
        JSON.stringify({ title: '卡片', body: '摘要', format: 'text', metadata: { images: [] } }),
    );

    const videoPath = join(dir, '32-video', `${STAMP}_video.mp4`);
    if (options.withRender === true) {
        writeFileSync(videoPath, 'mp4');
        writeFileSync(
            join(dir, '32-video', `${STAMP}_video_content.json`),
            JSON.stringify({
                ...VIDEO_CONTENT,
                format: options.contentFormat ?? 'video',
                metadata: { ...VIDEO_CONTENT.metadata, videoPath, coverPath: join(dir, '23-cover', 'cover.png') },
            }),
        );
    }
    return { dir, videoPath };
}

function readVariant(dir: string, key: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(dir, '30-variants', `${key}.content.json`), 'utf-8')) as Record<
        string,
        unknown
    >;
}

describe('0449/0450 — video variants in the frozen bundle', () => {
    test('writes video plus the shipinhao, xhs and youtube variants with each channel’s own key', () => {
        const { dir, videoPath } = makeRun({ withRender: true });
        try {
            dailyBundleVariants([dir, STAMP, '']);

            const base = readVariant(dir, 'video');
            expect(base.format).toBe('video');
            expect((base.metadata as Record<string, unknown>).videoPath).toBe(videoPath);

            const shipinhao = readVariant(dir, 'video@shipinhao-pub');
            expect(shipinhao.title).toBe(VIDEO_CONTENT.title);
            expect(shipinhao.format).toBe('video');
            expect(shipinhao.metadata).toMatchObject({
                videoPath,
                publishStatus: 'draft',
                tags: ['ai', 'daily'],
            });
            expect((shipinhao.metadata as Record<string, unknown>).coverPath).toBe(join(dir, '23-cover', 'cover.png'));

            // 0450 R6: the YouTube copy is the video-gen Content unchanged (privacy is the
            // client's private-first default, and a frozen variant carries no options block).
            const youtube = readVariant(dir, 'video@youtube-pub');
            expect(youtube.format).toBe('video');
            expect(youtube.metadata).toMatchObject({ videoPath, generator: 'kk:video-gen' });
            expect(youtube.options).toBeUndefined();

            const xhs = readVariant(dir, 'video@xhs-pub');
            // 上传视频 reads `metadata.video`; the cover claim is dropped (xhs has no cover rail).
            expect(xhs.metadata).toMatchObject({
                video: videoPath,
                operation: '上传视频',
                publishStatus: 'draft',
            });
            expect((xhs.metadata as Record<string, unknown>).coverPath).toBeUndefined();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('records a skip and writes no video variant when there is no 32-video render', () => {
        const { dir } = makeRun();
        try {
            expect(() => dailyBundleVariants([dir, STAMP, ''])).not.toThrow();
            expect(() => readVariant(dir, 'video')).toThrow();
            const logged = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
            expect(logged).toContain('video (no 32-video render)');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('buildVideoVariant refuses non-video content, a missing path and a missing file', () => {
        const { dir } = makeRun({ withRender: true });
        try {
            expect(() => buildVideoVariant({ ...VIDEO_CONTENT, format: 'markdown' }, 'xhs-pub')).toThrow(
                /expected 'video'/,
            );
            expect(() =>
                buildVideoVariant({ ...VIDEO_CONTENT, metadata: { ...VIDEO_CONTENT.metadata } }, 'xhs-pub'),
            ).toThrow(/no metadata.videoPath/);
            expect(() =>
                buildVideoVariant(
                    { ...VIDEO_CONTENT, metadata: { ...VIDEO_CONTENT.metadata, videoPath: join(dir, 'gone.mp4') } },
                    'xhs-pub',
                ),
            ).toThrow(/rendered video is missing/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('the ADR-059 short-form gate classifies the video keys', () => {
        expect(isShortFormVariant('video')).toBe(true);
        expect(isShortFormVariant('video@shipinhao-pub')).toBe(true);
        expect(isShortFormVariant('video@xhs-pub')).toBe(true);
        expect(isShortFormVariant('episode')).toBe(false);
        expect(isShortFormVariant('cards')).toBe(true);
    });
});

describe('0449 R3 — the typed video request stage', () => {
    test('writes the Doc[] request the generator contract validates', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-video-request-'));
        try {
            dailyVideoRequest([dir, STAMP, 'editorial']);
            const request = JSON.parse(readFileSync(join(dir, '32-video', 'request.json'), 'utf-8')) as Array<{
                id: string;
                body: string;
                metadata: Record<string, unknown>;
            }>;
            // `kk executor run` validates a generator's --in against DocListSchema, so the request
            // rides in Doc[0].metadata (see 0448's `parseVideoGenRequestInput`).
            expect(request).toHaveLength(1);
            expect(request[0]?.id).toBe('video-gen-request');
            expect(request[0]?.metadata).toEqual({ workDir: resolve(dir), runDate: STAMP, visualMode: 'editorial' });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('maps editorial-wan to the Colab provider (0451 R6)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-video-request-'));
        try {
            dailyVideoRequest([dir, STAMP, 'editorial-wan']);
            const request = JSON.parse(readFileSync(join(dir, '32-video', 'request.json'), 'utf-8')) as Array<{
                metadata: { visualMode: string; provider?: string };
            }>;
            expect(request[0]?.metadata).toMatchObject({ visualMode: 'editorial', provider: 'wan21-i2v' });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('defaults the visual mode to editorial', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-video-request-'));
        try {
            dailyVideoRequest([dir, STAMP]);
            const request = JSON.parse(readFileSync(join(dir, '32-video', 'request.json'), 'utf-8')) as Array<{
                metadata: { visualMode: string };
            }>;
            expect(request[0]?.metadata.visualMode).toBe('editorial');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('0449 R5 — preset rows for the video variants', () => {
    test('declares both rows at mode off and non-required, and the preset still validates', () => {
        const presetPath = join(import.meta.dir, '..', 'publish-presets', 'daily-ai-voice.json');
        const shipped = JSON.parse(readFileSync(presetPath, 'utf-8')) as {
            targets: Array<{ plugin: string; operation: string; variant?: string; mode: string; required?: boolean }>;
        };
        expect(PublishPresetSchema.safeParse(shipped).success).toBe(true);

        const shipinhao = shipped.targets.find((row) => row.variant === 'video@shipinhao-pub');
        expect(shipinhao).toMatchObject({
            plugin: 'shipinhao-pub',
            operation: 'shortVideo',
            mode: 'off',
            required: false,
        });
        const xhs = shipped.targets.find((row) => row.variant === 'video@xhs-pub');
        expect(xhs).toMatchObject({ plugin: 'xhs-pub', operation: '上传视频', mode: 'off', required: false });
        // 0450 R6: the YouTube Shorts row ships off as well — one upload per run at most, operator-gated.
        const youtube = shipped.targets.find((row) => row.variant === 'video@youtube-pub');
        expect(youtube).toMatchObject({ plugin: 'youtube-pub', operation: 'video', mode: 'off', required: false });
    });
});

describe('0449 R3 — the workflow node', () => {
    const workflowPath = join(import.meta.dir, '..', 'workflows', 'kk-news-generate.yaml');
    const dag = Bun.YAML.parse(readFileSync(workflowPath, 'utf-8')) as {
        vars: Record<string, string>;
        nodes: {
            id: string;
            dependsOn?: string[];
            condition?: { kind: string; options?: { command?: string } };
            action?: { kind: string; onError?: string; options?: { command?: string } };
        }[];
    };
    const byId = new Map(dag.nodes.map((node) => [node.id, node]));

    test('the video node sits between cards and variants, gated on vars.video and continue-on-error', () => {
        expect(dag.vars.video).toBe('off');
        const node = byId.get('video');
        expect(node?.dependsOn).toEqual(['voice', 'voice-fallback', 'voice-fallback2', 'cards']);
        expect(node?.action?.kind).toBe('shell');
        expect(node?.action?.onError).toBe('continue');
        expect(String(node?.action?.options?.command)).toContain('kk stage daily-video-request');
        expect(String(node?.action?.options?.command)).toContain('kk executor run video-gen');
        expect(String(node?.condition?.options?.command)).toContain(`\${vars.video}`);

        const order = dag.nodes.map((entry) => entry.id);
        expect(order.indexOf('video')).toBeGreaterThan(order.indexOf('cards'));
        expect(order.indexOf('video')).toBeLessThan(order.indexOf('variants'));
    });
});
