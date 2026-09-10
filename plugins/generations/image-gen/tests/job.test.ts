import { describe, expect, test } from 'bun:test';
import type { Doc } from '@gobing-ai/kk-core';
import { IMAGE_JOBS, type ImageJobSpec, ImageJobSpecSchema, parseJobSpec, readPositions } from '../src/job';

function docWith(metadata: Record<string, unknown> | undefined, overrides: Partial<Doc> = {}): Doc {
    return { id: 'd1', body: 'the prompt', ...(metadata === undefined ? {} : { metadata }), ...overrides };
}

describe('R1 — ImageJobSpec envelope', () => {
    test('a minimal spec { job } parses — a bare { job: "cover" } is a complete job', () => {
        const spec = ImageJobSpecSchema.parse({ job: 'cover' });
        expect(spec.job).toBe('cover');
    });

    test('a fully populated spec round-trips every field', () => {
        const spec: ImageJobSpec = {
            job: 'illustration',
            format: 'illustration',
            style: 'sketch',
            vars: { concept: 'x' },
            extra: 'tail',
            provider: 'openai',
            model: 'gpt-image-2',
            referenceImages: ['/abs/ref.png'],
            count: 3,
            maxImages: 4,
            seed: 7,
            outputStem: 'custom',
        };
        expect(ImageJobSpecSchema.parse(spec)).toEqual(spec);
    });

    test('parseJobSpec reads docs[0].metadata.imageGen', () => {
        expect(parseJobSpec([docWith({ imageGen: { job: 'free' } })])).toEqual({ job: 'free' });
    });

    test('the envelope is first-doc: a second doc carrying imageGen is content, not a spec', () => {
        const docs = [docWith({ imageGen: { job: 'free' } }), docWith({ imageGen: { job: 'cover' } }, { id: 'd2' })];
        expect(parseJobSpec(docs).job).toBe('free');
    });
});

describe('R1 — the spec fails loud with the frozen path and job list', () => {
    test('missing metadata entirely throws naming metadata.imageGen and all three jobs', () => {
        expect(() => parseJobSpec([docWith(undefined)])).toThrow(/metadata\.imageGen/);
        for (const job of IMAGE_JOBS) {
            expect(() => parseJobSpec([docWith(undefined)])).toThrow(new RegExp(`'${job}'`));
        }
    });

    test('metadata without an imageGen key throws the same way', () => {
        expect(() => parseJobSpec([docWith({ other: 1 })])).toThrow(/metadata\.imageGen/);
    });

    test('a null or array imageGen is not an object and throws', () => {
        expect(() => parseJobSpec([docWith({ imageGen: null })])).toThrow(/metadata\.imageGen/);
        expect(() => parseJobSpec([docWith({ imageGen: [{ job: 'free' }] })])).toThrow(/metadata\.imageGen/);
    });

    test('an unknown job throws listing free, cover, illustration', () => {
        expect(() => parseJobSpec([docWith({ imageGen: { job: 'banner' } })])).toThrow(/metadata\.imageGen/);
        expect(() => parseJobSpec([docWith({ imageGen: { job: 'banner' } })])).toThrow(/free.*cover.*illustration/s);
    });

    test('strict parsing: an unknown key fails loud instead of vanishing', () => {
        expect(() => parseJobSpec([docWith({ imageGen: { job: 'free', jobs: 'typo' } })])).toThrow(/jobs/);
    });

    test('count and maxImages must be positive integers', () => {
        expect(() => parseJobSpec([docWith({ imageGen: { job: 'illustration', count: 0 } })])).toThrow(/count/);
        expect(() => parseJobSpec([docWith({ imageGen: { job: 'illustration', maxImages: 1.5 } })])).toThrow(
            /maxImages/,
        );
    });
});

describe('R4 handoff — metadata.positions shape', () => {
    test('absent positions read as undefined', () => {
        expect(readPositions([docWith(undefined)])).toBeUndefined();
    });

    test('string anchors round-trip', () => {
        expect(readPositions([docWith({ positions: ['Loose Coupling', 'API Endpoints'] })])).toEqual([
            'Loose Coupling',
            'API Endpoints',
        ]);
    });

    test('a non-string anchor fails loud naming the path', () => {
        expect(() => readPositions([docWith({ positions: ['ok', 3] })])).toThrow(/metadata\.positions/);
    });
});
