import { describe, expect, test } from 'bun:test';
import { parseMusicBrief } from '../src/brief';
import { resolveJob } from '../src/presets';
import {
    type MusicGenerateRequest,
    REQUEST_FIELD_ORIGINS,
    REQUEST_KEY_ORDER,
    renderGenerateRequest,
    renderTakeRequests,
    serializeRequest,
} from '../src/request';
import { GOLDEN_NAMES, loadGoldenBrief, loadGoldenJob, readGoldenRequestJson } from './goldens';

/**
 * AC3 — request fields never fall through to an instance default (R3): the Pro
 * request always carries `durationTarget` and `language`, the Clip request
 * never carries `durationTarget`, `takes: N` renders N identical single-take
 * requests, and every golden request body is pinned byte for byte.
 */

const PRO_GOLDEN = 'pro-with-lyrics';
const CLIP_GOLDEN = 'clip';

describe('AC3 — request mapping', () => {
    for (const name of GOLDEN_NAMES) {
        test(`${name}: serialized request matches the golden byte for byte`, () => {
            const request = renderGenerateRequest(loadGoldenJob(name));
            expect(serializeRequest(request)).toBe(readGoldenRequestJson(name));
        });
    }

    test('the pro golden carries durationTarget 0:30 and an explicit language', () => {
        const request = renderGenerateRequest(loadGoldenJob(PRO_GOLDEN));
        expect(loadGoldenBrief(PRO_GOLDEN).duration_target).toBe('0:30');
        expect(request.model).toBe('pro');
        expect(request.durationTarget).toBe('0:30');
        expect(request.language).toBe('EN');
    });

    test('the clip golden carries no durationTarget even though the brief sets one', () => {
        const brief = loadGoldenBrief(CLIP_GOLDEN);
        expect(brief.duration_target).toBe('0:30');
        const request = renderGenerateRequest(resolveJob(brief));
        expect(request.model).toBe('clip');
        expect('durationTarget' in request).toBe(false);
        expect(serializeRequest(request)).not.toContain('durationTarget');
    });

    test('takes: 3 renders three identical single-take requests', () => {
        const brief = parseMusicBrief({
            ...loadGoldenBrief(PRO_GOLDEN),
            takes: 3,
        });
        const job = resolveJob(brief);
        const requests = renderTakeRequests(job);
        expect(requests).toHaveLength(3);
        expect(new Set(requests.map((request) => JSON.stringify(request))).size).toBe(1);
        for (const request of requests) {
            expect(request.batchCount).toBe(1);
        }
    });

    test('batchCount is the single-take label, never the take count', () => {
        const job = resolveJob(parseMusicBrief({ ...loadGoldenBrief(PRO_GOLDEN), takes: 2 }));
        expect(job.takes).toBe(2);
        expect(renderTakeRequests(job).map((request) => request.batchCount)).toEqual([1, 1]);
    });

    test('the instrumental request sends lyrics: "" and a lyrics-free brief omits the key', () => {
        expect(renderGenerateRequest(loadGoldenJob('instrumental')).lyrics).toBe('');
        const lyricsFree = renderGenerateRequest(loadGoldenJob('lyrics-free'));
        expect('lyrics' in lyricsFree).toBe(false);
    });

    test('authored lyrics are sent verbatim', () => {
        const request = renderGenerateRequest(loadGoldenJob(PRO_GOLDEN));
        expect(request.lyrics).toBe(loadGoldenBrief(PRO_GOLDEN).lyrics as string);
    });

    test('language is always present, never defaulted by the instance', () => {
        for (const name of GOLDEN_NAMES) {
            const request = renderGenerateRequest(loadGoldenJob(name));
            expect(typeof request.language).toBe('string');
            expect(request.language.length).toBeGreaterThan(0);
        }
        const noLanguage = parseMusicBrief({
            title: 'T',
            format: 'song',
            theme: 'lofi',
            duration_target: '0:30',
            style: 'Direction.',
        });
        expect(renderGenerateRequest(resolveJob(noLanguage)).language).toBe('EN');
    });

    test('audio_format maps to the wire format field', () => {
        const wav = parseMusicBrief({
            title: 'T',
            format: 'song',
            theme: 'lofi',
            duration_target: '0:30',
            audio_format: 'wav',
            style: 'Direction.',
        });
        expect(renderGenerateRequest(resolveJob(wav)).format).toBe('wav');
    });

    test('images survive in brief order and are absent when the brief has none', () => {
        const withImages = parseMusicBrief({
            title: 'T',
            format: 'song',
            theme: 'lofi',
            duration_target: '0:30',
            style: 'Direction.',
            images: ['b.png', 'a.png'],
        });
        expect(renderGenerateRequest(resolveJob(withImages)).images).toEqual(['b.png', 'a.png']);
        expect('images' in renderGenerateRequest(loadGoldenJob(PRO_GOLDEN))).toBe(false);
    });

    test('the wire key order matches the pinned order', () => {
        const request = renderGenerateRequest(loadGoldenJob(PRO_GOLDEN));
        expect(Object.keys(request)).toEqual(REQUEST_KEY_ORDER.filter((key) => key in request));
    });

    test('every wire field names a brief origin, and the prompt has no origin of its own', () => {
        expect(Object.keys(REQUEST_FIELD_ORIGINS).sort()).toEqual([...REQUEST_KEY_ORDER].sort());
        const request: MusicGenerateRequest = renderGenerateRequest(loadGoldenJob(PRO_GOLDEN));
        for (const key of Object.keys(request)) {
            expect(REQUEST_FIELD_ORIGINS[key as keyof MusicGenerateRequest]).toBeTruthy();
        }
    });

    test('a pro request without durationTarget is refused before the wire', () => {
        const job = loadGoldenJob(PRO_GOLDEN);
        const tampered = { ...job, duration_target: { value: undefined, source: 'builtin' as const } };
        expect(() => renderGenerateRequest(tampered)).toThrow(/3:00/);
    });
});
