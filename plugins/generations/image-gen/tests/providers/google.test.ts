import { describe, expect, test } from 'bun:test';
import {
    buildGoogleUrl,
    buildPromptWithAspect,
    extractInlineImageData,
    extractPredictedImageData,
    isGoogleImagen,
    isGoogleMultimodal,
    normalizeGoogleModelId,
} from '../../src/providers/google';

describe('google helpers', () => {
    test('normalize model IDs and read model family', () => {
        expect(normalizeGoogleModelId('models/gemini-3.1-flash-image-preview')).toBe('gemini-3.1-flash-image-preview');
        expect(isGoogleMultimodal('models/gemini-3-pro-image-preview')).toBe(true);
        expect(isGoogleMultimodal('gemini-3-pro-image')).toBe(true);
        expect(isGoogleMultimodal('gemini-3.1-flash-image')).toBe(true);
        expect(isGoogleMultimodal('models/gemini-3-pro-image')).toBe(true);
        expect(isGoogleImagen('imagen-3.0-generate-002')).toBe(true);
    });

    test('URL builder appends v1beta when the base URL lacks it', () => {
        expect(buildGoogleUrl('https://generativelanguage.googleapis.com', 'models/demo:generateContent')).toBe(
            'https://generativelanguage.googleapis.com/v1beta/models/demo:generateContent',
        );
        expect(buildGoogleUrl('https://example.com/custom/v1beta/', 'models/demo:predict')).toBe(
            'https://example.com/custom/v1beta/models/demo:predict',
        );
    });

    test('prompt aspect hints compose', () => {
        expect(buildPromptWithAspect('A city skyline', '16:9', '2k')).toBe(
            'A city skyline Aspect ratio: 16:9. High resolution 2048px.',
        );
    });

    test('response extractors find inline and predicted payloads', () => {
        expect(
            extractInlineImageData({
                candidates: [{ content: { parts: [{ inlineData: { data: 'inline-base64' } }] } }],
            }),
        ).toBe('inline-base64');
        expect(extractPredictedImageData({ predictions: [{ image: { imageBytes: 'predicted-base64' } }] })).toBe(
            'predicted-base64',
        );
        expect(extractPredictedImageData({ generatedImages: [{ bytesBase64Encoded: 'generated-base64' }] })).toBe(
            'generated-base64',
        );
    });
});
