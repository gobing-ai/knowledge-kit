import { describe, expect, test } from 'bun:test';
import { parseMusicBrief } from '../src/brief';
import { canonicalDigestJson, canonicalDigestSha256, digestInput, takeDigest } from '../src/digest';
import { resolveJob } from '../src/presets';
import { loadGoldenBrief, loadGoldenJob } from './goldens';

/**
 * Digest input (task 0397 Design "Digest input"): the canonical request 0400
 * uses as its run-scoped dedupe key. The form is frozen here so 0400 never
 * re-derives it, and it is pinned by a canonical-JSON assertion.
 */

describe('digest input', () => {
    test('canonical JSON is the pinned shape with absent values as null', () => {
        const input = digestInput(loadGoldenJob('pro-with-lyrics'));
        expect(canonicalDigestJson(input)).toBe(
            JSON.stringify({
                model: 'pro',
                prompt: input.prompt,
                lyrics: '[Verse]\nLast tram humming through the rain\nEvery window holds a name\n[Chorus]\nMidnight cable car, carry me home\nMidnight cable car, I am not alone',
                durationTarget: '0:30',
                language: 'EN',
                images: [],
                takeIndex: 0,
            }),
        );
        expect(input).toEqual({
            model: 'pro',
            prompt: input.prompt,
            lyrics: '[Verse]\nLast tram humming through the rain\nEvery window holds a name\n[Chorus]\nMidnight cable car, carry me home\nMidnight cable car, I am not alone',
            durationTarget: '0:30',
            language: 'EN',
            images: [],
            takeIndex: 0,
        });
    });

    test('the digest prompt is the rendered prompt text, not the raw brief', () => {
        const input = digestInput(loadGoldenJob('instrumental'));
        expect(input.prompt).toContain('Instrumental only — no vocals.');
        expect(input.prompt).not.toContain('Total running time');
    });

    test('instrumental jobs digest an empty lyrics payload; a clip job digests a null durationTarget', () => {
        expect(digestInput(loadGoldenJob('instrumental')).lyrics).toBe('');
        const clip = digestInput(loadGoldenJob('clip'));
        expect(clip.durationTarget).toBeNull();
        expect(clip.lyrics).toBeNull();
    });

    test('the hash is stable and 64 hex characters', () => {
        const job = loadGoldenJob('pro-with-lyrics');
        const first = canonicalDigestSha256(digestInput(job));
        const second = canonicalDigestSha256(digestInput(job));
        expect(second).toBe(first);
        expect(first).toMatch(/^[0-9a-f]{64}$/);
    });

    test('one field change changes the hash', () => {
        const base = loadGoldenBrief('pro-with-lyrics');
        const baseHash = canonicalDigestSha256(digestInput(resolveJob(base)));
        const hash = 'a'.repeat(64);
        const variants: Array<{ brief: Record<string, unknown>; imageHashes?: string[] }> = [
            { brief: { ...base, model: 'clip' as const, duration_target: '0:30' } },
            { brief: { ...base, lyrics: `${base.lyrics as string}\nOne more line` } },
            { brief: { ...base, duration_target: '0:45' } },
            { brief: { ...base, language: 'ja' } },
            { brief: { ...base, style: 'Different direction.' } },
            { brief: { ...base, images: ['ref.png'] }, imageHashes: [hash] },
            { brief: { ...base, images: ['ref.png'] }, imageHashes: ['b'.repeat(64)] },
        ];
        const hashes = variants.map((variant) =>
            canonicalDigestSha256(
                digestInput(
                    resolveJob(parseMusicBrief(variant.brief)),
                    variant.imageHashes === undefined ? {} : { imageHashes: variant.imageHashes },
                ),
            ),
        );
        for (const hash of hashes) {
            expect(hash).not.toBe(baseHash);
        }
        expect(new Set(hashes).size).toBe(hashes.length);
    });

    test('takes 3 yields three digests that differ only by takeIndex', () => {
        const job = resolveJob(parseMusicBrief({ ...loadGoldenBrief('pro-with-lyrics'), takes: 3 }));
        const digests = [0, 1, 2].map((takeIndex) => takeDigest(job, { takeIndex }));
        expect(new Set(digests.map((digest) => digest.sha256)).size).toBe(3);
        expect(digests.map((digest) => digest.input.takeIndex)).toEqual([0, 1, 2]);
        const payloads = digests.map((digest) => canonicalDigestJson({ ...digest.input, takeIndex: 0 }));
        expect(new Set(payloads).size).toBe(1);
    });

    test('images need one content hash each, in order', () => {
        const withImages = resolveJob(
            parseMusicBrief({ ...loadGoldenBrief('pro-with-lyrics'), images: ['b.png', 'a.png'] }),
        );
        expect(() => digestInput(withImages)).toThrow(/one content hash per image/);
        expect(() => digestInput(withImages, { imageHashes: ['1'] })).toThrow(/one content hash per image/);
        expect(digestInput(withImages, { imageHashes: ['hash-b', 'hash-a'] }).images).toEqual(['hash-b', 'hash-a']);
    });

    test('a bad take index is refused', () => {
        const job = loadGoldenJob('pro-with-lyrics');
        expect(() => digestInput(job, { takeIndex: -1 })).toThrow(/non-negative integer/);
        expect(() => digestInput(job, { takeIndex: 0.5 })).toThrow(/non-negative integer/);
    });

    test('distinct briefs never alias', () => {
        const names = ['clip', 'instrumental', 'lyrics-free', 'pro-with-lyrics'] as const;
        const hashes = names.map((name) => takeDigest(loadGoldenJob(name)).sha256);
        expect(new Set(hashes).size).toBe(names.length);
    });
});
