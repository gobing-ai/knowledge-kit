/**
 * @gobing-ai/kk-core — platform content limits and character counting algorithms.
 * Sourced and formalized from production multi-platform publishing standards.
 */

export type ContentCountUnit = 'utf16_code_units' | 'unicode_code_points' | 'weighted' | 'xiaohongshu_title_weighted';

const URL_PATTERN = /https?:\/\/[^\s]+/giu;

function isSingleWeightXCodePoint(codePoint: number): boolean {
    return (
        codePoint <= 0x10ff ||
        (codePoint >= 0x2000 && codePoint <= 0x200d) ||
        (codePoint >= 0x2010 && codePoint <= 0x201f) ||
        (codePoint >= 0x2032 && codePoint <= 0x2037)
    );
}

function countXText(value: string): number {
    let total = 0;
    for (const char of Array.from(value)) {
        const cp = char.codePointAt(0) ?? 0;
        total += isSingleWeightXCodePoint(cp) ? 1 : 2;
    }
    return total;
}

/**
 * Calculates weighted character count matching Twitter / X standard:
 * - Single-weight: ASCII and standard punctuation (1 unit)
 * - Double-weight: CJK and wide characters (2 units)
 * - URLs: Any HTTP/HTTPS link counts as exactly 23 characters (t.co wrap)
 */
export function countXWeightedCharacters(value: string): number {
    const text = String(value || '');
    let total = 0;
    let cursor = 0;
    for (const match of text.matchAll(URL_PATTERN)) {
        const idx = match.index ?? 0;
        total += countXText(text.slice(cursor, idx));
        total += 23;
        cursor = idx + match[0].length;
    }
    return total + countXText(text.slice(cursor));
}

/**
 * Xiaohongshu weighted title accounting:
 * - CJK characters = 1 unit
 * - ASCII characters = 0.5 unit (2 ASCII chars = 1 unit)
 */
export function countXiaohongshuTitleWeighted(value: string): number {
    let asciiCount = 0;
    let cjkCount = 0;
    for (const char of Array.from(String(value || ''))) {
        const cp = char.codePointAt(0) ?? 0;
        if (cp <= 0x7f) {
            asciiCount++;
        } else {
            cjkCount++;
        }
    }
    return cjkCount + Math.ceil(asciiCount / 2);
}

/**
 * Unified content counter supporting all platform accounting units.
 */
export function countContentUnits(text: string, unit: ContentCountUnit): number {
    if (!text) return 0;
    switch (unit) {
        case 'utf16_code_units':
            return text.length;
        case 'unicode_code_points':
            return Array.from(text).length;
        case 'weighted':
            return countXWeightedCharacters(text);
        case 'xiaohongshu_title_weighted':
            return countXiaohongshuTitleWeighted(text);
        default:
            return text.length;
    }
}

/** Per-platform limit entry: maximum count, counting unit, and overflow behavior. */
export interface PlatformLimitEntry {
    readonly max: number;
    readonly unit: ContentCountUnit;
    readonly behavior?: 'split_thread' | 'truncate' | 'reject';
}

/** Frozen v5 schema of per-platform content limits (tags, title/body capability entries). */
export interface PlatformLimitsConfig {
    readonly schemaVersion: number;
    readonly tagLimits: {
        readonly default: number;
        readonly imageText: Record<string, number>;
        readonly shortVideo: Record<string, number>;
    };
    readonly titleCapabilities: Record<string, Record<string, PlatformLimitEntry | null>>;
    readonly bodyCapabilities: Record<string, Record<string, PlatformLimitEntry | null>>;
}

/** The shipped frozen platform content limits table (`schemaVersion` 5). */
export const PLATFORM_CONTENT_LIMITS: PlatformLimitsConfig = Object.freeze({
    schemaVersion: 5,
    tagLimits: Object.freeze({
        default: 7,
        imageText: Object.freeze({
            instagram: 5,
            douyin: 5,
            kuaishou: 4,
            weixin: 1,
            xiaohongshu: 10,
        }),
        shortVideo: Object.freeze({
            douyin: 5,
            kuaishou: 4,
            xiaohongshu: 10,
            bilibili: 10,
            zhihu: 5,
            tiktok: 20,
            youtube: 60,
        }),
    }),
    titleCapabilities: Object.freeze({
        dynamic: Object.freeze({
            bilibili: Object.freeze({ max: 20, unit: 'utf16_code_units' }),
            zhihu: Object.freeze({ max: 50, unit: 'utf16_code_units' }),
            douban: Object.freeze({ max: 70, unit: 'utf16_code_units' }),
            x: null,
            threads: null,
            weibo: null,
            jike: null,
            zsxq: null,
            toutiao: null,
            juejin: null,
        }),
        imageText: Object.freeze({
            xiaohongshu: Object.freeze({ max: 20, unit: 'xiaohongshu_title_weighted' }),
            weixin: Object.freeze({ max: 20, unit: 'utf16_code_units' }),
            douyin: Object.freeze({ max: 20, unit: 'utf16_code_units' }),
            shipinhao: Object.freeze({ max: 22, unit: 'utf16_code_units' }),
            reddit: Object.freeze({ max: 300, unit: 'utf16_code_units' }),
        }),
        article: Object.freeze({
            juejin: Object.freeze({ max: 100, unit: 'utf16_code_units' }),
            csdn: Object.freeze({ max: 100, unit: 'utf16_code_units' }),
            cnblogs: Object.freeze({ max: 128, unit: 'utf16_code_units' }),
            weibo: Object.freeze({ max: 30, unit: 'utf16_code_units' }),
            sspai: Object.freeze({ max: 80, unit: 'utf16_code_units' }),
        }),
        shortVideo: Object.freeze({
            shipinhao: Object.freeze({ max: 16, unit: 'utf16_code_units' }),
            douyin: Object.freeze({ max: 30, unit: 'utf16_code_units' }),
            bilibili: Object.freeze({ max: 80, unit: 'utf16_code_units' }),
        }),
    }),
    bodyCapabilities: Object.freeze({
        dynamic: Object.freeze({
            threads: Object.freeze({ max: 500, unit: 'unicode_code_points', behavior: 'split_thread' }),
            x: Object.freeze({ max: 280, unit: 'weighted', behavior: 'split_thread' }),
            weibo: Object.freeze({ max: 2000, unit: 'unicode_code_points' }),
            jike: Object.freeze({ max: 1000, unit: 'unicode_code_points' }),
        }),
        imageText: Object.freeze({
            xiaohongshu: Object.freeze({ max: 1000, unit: 'unicode_code_points' }),
            douyin: Object.freeze({ max: 1000, unit: 'unicode_code_points' }),
        }),
        article: Object.freeze({
            wechatmp: Object.freeze({ max: 50000, unit: 'unicode_code_points' }),
            juejin: Object.freeze({ max: 50000, unit: 'unicode_code_points' }),
        }),
        shortVideo: Object.freeze({
            douyin: Object.freeze({ max: 1000, unit: 'unicode_code_points' }),
            kuaishou: Object.freeze({ max: 1000, unit: 'unicode_code_points' }),
            shipinhao: Object.freeze({ max: 1000, unit: 'unicode_code_points' }),
        }),
    }),
});

/** Content to validate against a platform's limits: platform id, content type and optional parts. */
export interface ContentValidationInput {
    readonly platform: string;
    readonly contentType: 'dynamic' | 'imageText' | 'article' | 'shortVideo' | 'podcast';
    readonly title?: string;
    readonly body?: string;
    readonly tags?: readonly string[];
}

/** One limit violation: field, applicable max, measured current size and by how much it was exceeded. */
export interface ContentValidationError {
    readonly field: 'title' | 'body' | 'tags';
    readonly max: number;
    readonly current: number;
    readonly exceededBy: number;
    readonly unit?: ContentCountUnit;
}

/** Validation verdict: overall validity plus the list of field-level violations (empty when valid). */
export interface ContentValidationResult {
    readonly valid: boolean;
    readonly errors: readonly ContentValidationError[];
}

/**
 * Validates text content against platform constraints.
 */
export function validateContentLimits(input: ContentValidationInput): ContentValidationResult {
    const errors: ContentValidationError[] = [];

    // Title validation
    if (input.title) {
        const titleRule = PLATFORM_CONTENT_LIMITS.titleCapabilities[input.contentType]?.[input.platform];
        if (titleRule) {
            const current = countContentUnits(input.title, titleRule.unit);
            if (current > titleRule.max) {
                errors.push({
                    field: 'title',
                    max: titleRule.max,
                    current,
                    exceededBy: current - titleRule.max,
                    unit: titleRule.unit,
                });
            }
        }
    }

    // Body validation
    if (input.body) {
        const bodyRule = PLATFORM_CONTENT_LIMITS.bodyCapabilities[input.contentType]?.[input.platform];
        if (bodyRule) {
            const current = countContentUnits(input.body, bodyRule.unit);
            if (current > bodyRule.max) {
                errors.push({
                    field: 'body',
                    max: bodyRule.max,
                    current,
                    exceededBy: current - bodyRule.max,
                    unit: bodyRule.unit,
                });
            }
        }
    }

    // Tags count validation
    if (input.tags && input.tags.length > 0) {
        let tagMax: number = PLATFORM_CONTENT_LIMITS.tagLimits.default;
        const imageTextLimit = PLATFORM_CONTENT_LIMITS.tagLimits.imageText[input.platform];
        const shortVideoLimit = PLATFORM_CONTENT_LIMITS.tagLimits.shortVideo[input.platform];
        if (input.contentType === 'imageText' && typeof imageTextLimit === 'number') {
            tagMax = imageTextLimit;
        } else if (input.contentType === 'shortVideo' && typeof shortVideoLimit === 'number') {
            tagMax = shortVideoLimit;
        }
        if (input.tags.length > tagMax) {
            errors.push({
                field: 'tags',
                max: tagMax,
                current: input.tags.length,
                exceededBy: input.tags.length - tagMax,
            });
        }
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}
