import { describe, expect, it } from 'bun:test';
import {
    AggregateResultSchema,
    ContentSchema,
    DocSchema,
    omniVoiceGenContentSchema,
    ResultSchema,
    videoGenContentSchema,
} from '../src/index';

describe('DocSchema', () => {
    it('parses a well-formed Doc', () => {
        const doc = DocSchema.parse({ id: 'd1', body: 'hello' });
        expect(doc.id).toBe('d1');
        expect(doc.body).toBe('hello');
    });

    it('rejects missing required field with path naming the field', () => {
        const result = DocSchema.safeParse({ body: 'no-id' });
        expect(result.success).toBe(false);
        if (!result.success) {
            const paths = result.error.issues.map((i) => i.path.join('.'));
            expect(paths).toContain('id');
        }
    });
});

describe('ContentSchema', () => {
    it('parses a well-formed Content and defaults format to markdown', () => {
        const content = ContentSchema.parse({ body: '# Title\n\nBody' });
        expect(content.body).toContain('Title');
        expect(content.format).toBe('markdown');
    });

    it('rejects missing body with field-level path', () => {
        const result = ContentSchema.safeParse({ title: 't' });
        expect(result.success).toBe(false);
        if (!result.success) {
            const paths = result.error.issues.map((i) => i.path.join('.'));
            expect(paths).toContain('body');
        }
    });
});

describe('omniVoiceGenContentSchema', () => {
    const validAudioContent = {
        title: 'Daily AI Voice',
        body: 'title: Daily AI Voice\nsegments: []',
        format: 'audio',
        references: [],
        metadata: {
            generator: 'kk:omni-voice-gen',
            audioPath: '/tmp/episode.wav',
            duration: 42.5,
            segments: [{ generationId: 'g1', profile: 'narrator', duration: 42.5, verifyRetries: 0 }],
            mp3Path: '/tmp/episode.mp3',
            qc: { passed: true, overallScore: 95 },
        },
    };

    it('parses a valid omni-voice-gen audio Content', () => {
        const content = omniVoiceGenContentSchema.parse(validAudioContent);
        expect(content.format).toBe('audio');
        expect(content.metadata.generator).toBe('kk:omni-voice-gen');
        expect(content.metadata.segments).toHaveLength(1);
    });

    it("rejects Content whose metadata.generator isn't kk:omni-voice-gen", () => {
        const wrong = structuredClone(validAudioContent);
        wrong.metadata.generator = 'kk:voice-gen';
        const result = omniVoiceGenContentSchema.safeParse(wrong);
        expect(result.success).toBe(false);
        if (!result.success) {
            const paths = result.error.issues.map((i) => i.path.join('.'));
            expect(paths).toContain('metadata.generator');
        }
    });

    it('rejects non-audio format and missing audioPath', () => {
        expect(omniVoiceGenContentSchema.safeParse({ ...validAudioContent, format: 'markdown' }).success).toBe(false);
        const noAudio = structuredClone(validAudioContent);
        delete (noAudio.metadata as Record<string, unknown>).audioPath;
        expect(omniVoiceGenContentSchema.safeParse(noAudio).success).toBe(false);
    });
});

describe('videoGenContentSchema', () => {
    const validVideoContent = {
        title: 'Daily AI News teaser',
        body: 'A 52-second vertical teaser for the daily AI news episode.',
        format: 'video',
        metadata: {
            generator: 'kk:video-gen',
            videoPath: '/tmp/20261126_video.mp4',
            coverPath: '/tmp/20261126_cover.png',
            width: 1080,
            height: 1920,
            fps: 30,
            durationSec: 52,
            visualMode: 'editorial',
            renderProvider: 'local-ken-burns',
        },
    };

    it('parses a valid video Content and preserves the typed metadata', () => {
        const content = videoGenContentSchema.parse(validVideoContent);
        expect(content.format).toBe('video');
        expect(content.metadata.videoPath).toBe('/tmp/20261126_video.mp4');
        expect(content.metadata.width).toBe(1080);
        expect(content.metadata.height).toBe(1920);
        expect(content.metadata.durationSec).toBe(52);
        expect(content.metadata.visualMode).toBe('editorial');
        expect(content.metadata.renderProvider).toBe('local-ken-burns');
    });

    it('rejects a payload missing metadata.videoPath', () => {
        const noVideo = structuredClone(validVideoContent);
        delete (noVideo.metadata as Record<string, unknown>).videoPath;
        const result = videoGenContentSchema.safeParse(noVideo);
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.map((i) => i.path.join('.'))).toContain('metadata.videoPath');
        }
    });

    it('rejects a non-positive durationSec', () => {
        const zero = structuredClone(validVideoContent);
        zero.metadata.durationSec = 0;
        const result = videoGenContentSchema.safeParse(zero);
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.map((i) => i.path.join('.'))).toContain('metadata.durationSec');
        }
    });

    it('rejects an unknown visualMode or renderProvider', () => {
        const badMode = structuredClone(validVideoContent);
        badMode.metadata.visualMode = 'hologram';
        expect(videoGenContentSchema.safeParse(badMode).success).toBe(false);

        const badProvider = structuredClone(validVideoContent);
        badProvider.metadata.renderProvider = 'runway';
        expect(videoGenContentSchema.safeParse(badProvider).success).toBe(false);
    });
});

describe('ResultSchema', () => {
    it('parses a well-formed success Result', () => {
        const result = ResultSchema.parse({ ok: true, target: 'surfdash' });
        expect(result.ok).toBe(true);
        expect(result.target).toBe('surfdash');
    });

    it('rejects missing target with field-level path', () => {
        const parsed = ResultSchema.safeParse({ ok: false });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
            const paths = parsed.error.issues.map((i) => i.path.join('.'));
            expect(paths).toContain('target');
        }
    });
});

describe('AggregateResultSchema', () => {
    const validAggregate = {
        ok: true,
        summary: { total: 2, succeeded: 1, failed: 1, skipped: 0 },
        targets: [
            {
                target: 'surfdash',
                ok: true,
                status: 'published',
                url: 'https://surfdash.io/posts/1',
                id: 'surf_1',
                durationMs: 1420,
                metadata: { postPath: 'collab/posts/abc' },
            },
            { target: 'qiita', ok: false, status: 'failed', error: '429' },
        ],
    };

    it('0157 R11 — accepts a valid aggregate including per-target metadata', () => {
        const parsed = AggregateResultSchema.safeParse(validAggregate);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.targets[0]?.metadata).toEqual({ postPath: 'collab/posts/abc' });
            expect(parsed.data.summary.total).toBe(2);
        }
    });

    it('0157 R11 — rejects a bad status enum', () => {
        const bad = structuredClone(validAggregate);
        (bad.targets[0] as Record<string, unknown>).status = 'exploded';
        expect(AggregateResultSchema.safeParse(bad).success).toBe(false);
    });

    it('0157 R11 — rejects primitive metadata on a target', () => {
        const bad = structuredClone(validAggregate);
        (bad.targets[0] as Record<string, unknown>).metadata = 'oops';
        expect(AggregateResultSchema.safeParse(bad).success).toBe(false);
    });

    it('0157 R11 — strips unknown keys (hand-parser parity)', () => {
        const extra = {
            ...validAggregate,
            extraTop: 'drop-me',
            targets: [{ ...validAggregate.targets[0], extraField: 1 }, validAggregate.targets[1]],
        };
        const parsed = AggregateResultSchema.safeParse(extra);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data).not.toHaveProperty('extraTop');
            expect(parsed.data.targets[0]).not.toHaveProperty('extraField');
        }
    });
});
