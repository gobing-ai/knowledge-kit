import { describe, expect, it } from 'bun:test';
import {
    BUILTIN_CONTENT_TYPES,
    ContentTypeSchema,
    ContentTypeSkillMissingError,
    ContentTypeUnknownError,
    resolveContentType,
    resolveRun,
} from '../src/content-types';

const root = process.cwd();

describe('content type resolution (0363)', () => {
    it('merges config and flag precedence and computes the writer skill fingerprint', async () => {
        const resolved = await resolveContentType(
            'itc',
            {
                content_types: { itc: { publish_preset: 'technical-article', channels: { 'xhs-pub': 'off' } } },
            },
            { packageRoot: root },
        );
        expect(resolved.publish_preset).toBe('technical-article');
        expect(resolved.channels).toEqual({ 'xhs-pub': 'off' });
        expect(resolved.skillDir).toEndWith('/plugins/kk/skills/itc-generating');
        expect(resolved.skillSha256).toMatch(/^[0-9a-f]{64}$/);
        const flagged = await resolveContentType('itc', {}, { packageRoot: root, preset: 'chinese-article' });
        expect(flagged.publish_preset).toBe('chinese-article');
        await expect(resolveContentType('missing', {}, { packageRoot: root })).rejects.toBeInstanceOf(
            ContentTypeUnknownError,
        );
    });

    it('resolves canonical news and article workspaces', () => {
        expect(resolveRun({ type: 'news', worksDir: '/tmp/works', runDate: '20260101' })).toEqual({
            workDir: '/tmp/works/kk-news-generate/20260101',
            run: '20260101',
            workflow: 'kk-news-generate',
        });
        expect(resolveRun({ type: 'itc', worksDir: '/tmp/works', slug: 'demo' })).toEqual({
            workDir: '/tmp/works/kk-article-generate/demo',
            run: 'demo',
            workflow: 'kk-article-generate',
        });
        expect(
            resolveRun({ type: 'itc', worksDir: '/tmp/works', slug: 'demo', dated: true, runDate: '20260101' }).run,
        ).toBe('20260101-demo');
    });

    it('rejects missing skill files', async () => {
        await expect(
            resolveContentType(
                'itc',
                { content_types: { itc: { writer_skill: 'kk:no-such-skill' } } },
                { packageRoot: root },
            ),
        ).rejects.toBeInstanceOf(ContentTypeSkillMissingError);
        expect(BUILTIN_CONTENT_TYPES.news?.channels).toEqual({});
    });

    it('keeps the four-field schema strict and validates channel modes', () => {
        expect(() =>
            ContentTypeSchema.parse({
                workflow: 'kk-news-generate',
                writer_skill: 'kk:news-editorial',
                publish_preset: 'daily-ai-voice',
                channels: { 'xhs-pub': 'off' },
                works_namespace: 'legacy',
            }),
        ).toThrow();
        expect(() =>
            ContentTypeSchema.parse({
                workflow: 'kk-news-generate',
                writer_skill: 'kk:news-editorial',
                publish_preset: 'daily-ai-voice',
                channels: { 'xhs-pub': 'maybe' },
            }),
        ).toThrow();
    });
});
