import { describe, expect, test } from 'bun:test';
import {
    BRIEF_FIELD_TARGETS,
    durationSeconds,
    formatDuration,
    MAX_DURATION_SECONDS,
    MAX_IMAGES,
    MAX_TAKES,
    MusicBriefSchema,
    parseMusicBrief,
    parseMusicBriefYaml,
} from '../src/brief';
import { GOLDEN_NAMES, loadGoldenBrief } from './goldens';

/**
 * AC1 — the brief covers every provider-visible input (R1): every field parses
 * with a positive and a negative case, the schema is strict (an unknown key is a
 * loud failure, never a silent drop), and every schema key has a documented
 * prompt/request/resolution/recording target.
 */

/** A minimal valid brief; each case overrides one field. */
function validBrief(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        title: 'T',
        format: 'song',
        theme: 'cinematic',
        duration_target: '0:30',
        style: 'Technical direction.',
        ...overrides,
    };
}

describe('AC1 — MusicBrief schema', () => {
    test('parses every golden fixture', () => {
        for (const name of GOLDEN_NAMES) {
            const brief = loadGoldenBrief(name);
            expect(typeof brief.title).toBe('string');
            expect(typeof brief.takes).toBe('number');
        }
    });

    test('the YAML authoring form and the JSON form agree', () => {
        const yaml = [
            'title: Same',
            'format: song',
            'theme: lofi',
            'duration_target: "0:30"',
            'style: Direction.',
            'avoid: [a, b]',
            'takes: 2',
        ].join('\n');
        const fromYaml = parseMusicBriefYaml(yaml);
        const fromJson = parseMusicBrief({
            title: 'Same',
            format: 'song',
            theme: 'lofi',
            duration_target: '0:30',
            style: 'Direction.',
            avoid: ['a', 'b'],
            takes: 2,
        });
        expect(fromYaml).toEqual(fromJson);
    });

    // Positive and negative case per required-by-contract field (AC1).
    test('title: non-empty string is required', () => {
        expect(parseMusicBrief(validBrief({ title: 'Midnight' })).title).toBe('Midnight');
        expect(MusicBriefSchema.safeParse(validBrief({ title: '' })).success).toBe(false);
        expect(MusicBriefSchema.safeParse(validBrief({ title: 42 })).success).toBe(false);
    });

    test('model: pro|clip only, optional', () => {
        expect(parseMusicBrief(validBrief({ model: 'clip' })).model).toBe('clip');
        expect(parseMusicBrief(validBrief()).model).toBeUndefined();
        expect(MusicBriefSchema.safeParse(validBrief({ model: 'pro-2' })).success).toBe(false);
    });

    test('format and theme: preset names are required', () => {
        expect(parseMusicBrief(validBrief({ format: 'jingle', theme: 'lofi' })).theme).toBe('lofi');
        expect(MusicBriefSchema.safeParse(validBrief({ format: '' })).success).toBe(false);
        expect(MusicBriefSchema.safeParse(validBrief({ theme: undefined })).success).toBe(false);
    });

    test('duration_target: m:ss inside 0:05–3:00', () => {
        expect(parseMusicBrief(validBrief({ duration_target: '2:45' })).duration_target).toBe('2:45');
        expect(MusicBriefSchema.safeParse(validBrief({ duration_target: '3:5' })).success).toBe(false);
        expect(MusicBriefSchema.safeParse(validBrief({ duration_target: '0:04' })).success).toBe(false);
        expect(MusicBriefSchema.safeParse(validBrief({ duration_target: '3:01' })).success).toBe(false);
        expect(MAX_DURATION_SECONDS).toBe(180);
    });

    test('language: short tag only', () => {
        expect(parseMusicBrief(validBrief({ language: 'zh-CN' })).language).toBe('zh-CN');
        expect(MusicBriefSchema.safeParse(validBrief({ language: 'english please' })).success).toBe(false);
        expect(MusicBriefSchema.safeParse(validBrief({ language: 'e' })).success).toBe(false);
    });

    test('instrumental: boolean only, and it forbids lyrics', () => {
        expect(parseMusicBrief(validBrief({ instrumental: true })).instrumental).toBe(true);
        expect(MusicBriefSchema.safeParse(validBrief({ instrumental: 'yes' })).success).toBe(false);
        const conflict = MusicBriefSchema.safeParse(validBrief({ instrumental: true, lyrics: 'la la' }));
        expect(conflict.success).toBe(false);
        expect(MusicBriefSchema.safeParse(validBrief({ instrumental: true, lyrics: '  ' })).success).toBe(true);
    });

    test('audio_format: mp3|wav only', () => {
        expect(parseMusicBrief(validBrief({ audio_format: 'wav' })).audio_format).toBe('wav');
        expect(MusicBriefSchema.safeParse(validBrief({ audio_format: 'flac' })).success).toBe(false);
    });

    test('style: non-empty technical direction', () => {
        expect(parseMusicBrief(validBrief({ style: 'Slow strings.' })).style).toBe('Slow strings.');
        expect(MusicBriefSchema.safeParse(validBrief({ style: '' })).success).toBe(false);
        expect(MusicBriefSchema.safeParse(validBrief({ style: 7 })).success).toBe(false);
    });

    test('avoid: non-empty strings', () => {
        expect(parseMusicBrief(validBrief({ avoid: ['trap hats'] })).avoid).toEqual(['trap hats']);
        expect(MusicBriefSchema.safeParse(validBrief({ avoid: [''] })).success).toBe(false);
        expect(MusicBriefSchema.safeParse(validBrief({ avoid: 'trap hats' })).success).toBe(false);
    });

    test('structure: timestamped entries in non-decreasing order', () => {
        const structure = [
            { at: '0:00', section: 'Intro' },
            { at: '0:08', section: 'Verse', note: 'vocal enters' },
            { at: '0:08', section: 'Verse 2' },
        ];
        expect(parseMusicBrief(validBrief({ structure })).structure).toHaveLength(3);
        const backwards = [structure[1], structure[0]];
        expect(MusicBriefSchema.safeParse(validBrief({ structure: backwards })).success).toBe(false);
        expect(MusicBriefSchema.safeParse(validBrief({ structure: [{ at: '0:8', section: 'X' }] })).success).toBe(
            false,
        );
        expect(MusicBriefSchema.safeParse(validBrief({ structure: [{ at: '0:08' }] })).success).toBe(false);
        expect(
            MusicBriefSchema.safeParse(validBrief({ structure: [{ at: '0:08', section: 'X', mood: 'dark' }] })).success,
        ).toBe(false);
    });

    test('lyrics: free text, including an empty string', () => {
        expect(parseMusicBrief(validBrief({ lyrics: '[Verse]\nline' })).lyrics).toBe('[Verse]\nline');
        expect(parseMusicBrief(validBrief({ lyrics: '' })).lyrics).toBe('');
        expect(MusicBriefSchema.safeParse(validBrief({ lyrics: 1 })).success).toBe(false);
    });

    test(`images: at most ${MAX_IMAGES} paths`, () => {
        const ten = Array.from({ length: MAX_IMAGES }, (_, index) => `ref-${index}.png`);
        expect(parseMusicBrief(validBrief({ images: ten })).images).toHaveLength(MAX_IMAGES);
        expect(MusicBriefSchema.safeParse(validBrief({ images: [...ten, 'eleven.png'] })).success).toBe(false);
        expect(MusicBriefSchema.safeParse(validBrief({ images: [''] })).success).toBe(false);
    });

    test(`takes: integer 1..${MAX_TAKES}`, () => {
        expect(parseMusicBrief(validBrief({ takes: 4 })).takes).toBe(4);
        expect(MusicBriefSchema.safeParse(validBrief({ takes: 0 })).success).toBe(false);
        expect(MusicBriefSchema.safeParse(validBrief({ takes: 5 })).success).toBe(false);
        expect(MusicBriefSchema.safeParse(validBrief({ takes: 1.5 })).success).toBe(false);
    });

    test('meta: an object bag that never reaches the wire', () => {
        expect(parseMusicBrief(validBrief({ meta: { author: 'op' } })).meta).toEqual({ author: 'op' });
        expect(MusicBriefSchema.safeParse(validBrief({ meta: 'author' })).success).toBe(false);
    });

    test('an unknown key fails loudly instead of being dropped', () => {
        expect(MusicBriefSchema.safeParse(validBrief({ tempo: 92 })).success).toBe(false);
        expect(MusicBriefSchema.safeParse(validBrief({ negative_prompt: 'drums' })).success).toBe(false);
    });

    test('every schema key has exactly one documented target (R1 totality)', () => {
        const schemaKeys = Object.keys(MusicBriefSchema.shape).sort();
        const targetKeys = Object.keys(BRIEF_FIELD_TARGETS).sort();
        expect(targetKeys).toEqual(schemaKeys);
        for (const [field, target] of Object.entries(BRIEF_FIELD_TARGETS)) {
            const mapped = (target.prompt === undefined ? 0 : 1) + (target.request?.length ?? 0) > 0;
            expect(mapped || target.resolution === true || target.recording !== undefined).toBe(true);
            if (mapped) {
                continue;
            }
            // A field that never renders or ships must say where it is recorded.
            expect(`${field}: ${String(target.recording)}`).not.toBe(`${field}: undefined`);
        }
    });

    test('duration helpers round-trip', () => {
        expect(durationSeconds('0:30')).toBe(30);
        expect(durationSeconds('2:05')).toBe(125);
        expect(formatDuration(30)).toBe('0:30');
        expect(formatDuration(125)).toBe('2:05');
        expect(() => durationSeconds('thirty')).toThrow();
    });
});
