import type { Doc } from '@gobing-ai/kk-core';

/**
 * Query parameters that carry campaign/click provenance, never content identity:
 * `utm_*` (any variant) plus the four social/referrer markers below. Dropping
 * them is what makes the same page reached through two campaigns one item.
 */
const TRACKING_PARAMS = new Set(['ref', 'ref_src', 'fbclid', 'gclid']);

/** True when a query parameter is tracking noise rather than content identity. */
function isTrackingParam(name: string): boolean {
    const lower = name.toLowerCase();
    return lower.startsWith('utm_') || TRACKING_PARAMS.has(lower);
}

/**
 * Parse `input`, tolerating a missing scheme.
 *
 * A Doc's `sourceUri` sometimes arrives without one (`example.com/x`, hand-typed
 * operator input). Treating such a value as scheme-less https keeps the two
 * spellings of the same page on one item id; anything still unparseable is
 * returned verbatim by {@link canonicalUrl} rather than collapsed into a single
 * bucket with every other malformed URL.
 */
function parseUrl(input: string): URL | undefined {
    try {
        return new URL(input);
    } catch {
        /* Not an absolute URL — retry as scheme-less. */
    }
    try {
        return new URL(`https://${input}`);
    } catch {
        return undefined;
    }
}

/**
 * Canonicalize a URL for content identity: lowercase scheme and host, drop the
 * fragment, drop tracking parameters, sort the remaining query parameters, and
 * strip a trailing slash (except at the root).
 *
 * The output is deterministic for one logical page, so `sha256(canonicalUrl)`
 * is stable dedup key. Unparseable input is returned trimmed and unchanged.
 */
export function canonicalUrl(rawUrl: string): string {
    const input = rawUrl.trim();
    const parsed = parseUrl(input);
    if (parsed === undefined) return input;

    const remaining: Array<[string, string]> = [...parsed.searchParams.entries()].filter(
        ([name]) => !isTrackingParam(name),
    );
    remaining.sort(([aName, aValue], [bName, bValue]) => {
        if (aName !== bName) return aName < bName ? -1 : 1;
        if (aValue === bValue) return 0;
        return aValue < bValue ? -1 : 1;
    });
    const search = remaining.length === 0 ? '' : `?${new URLSearchParams(remaining).toString()}`;

    const stripped = parsed.pathname.replace(/\/+$/, '');
    const pathname = stripped === '' ? '/' : stripped;
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${pathname}${search}`;
}

/** Hex SHA-256 of `input` — the item-id digest. */
function sha256Hex(input: string): string {
    return new Bun.CryptoHasher('sha256').update(input).digest('hex');
}

/** Doc metadata slot a URL-less Doc may still carry its origin URL in. */
function originalUrlFromMetadata(metadata: Doc['metadata']): string | undefined {
    const value = metadata?.originalUrl;
    return typeof value === 'string' ? value : undefined;
}

/**
 * Stable identity for a Doc: `sha256(canonicalUrl(...))` when it carries a URL
 * (`sourceUri`, falling back to `metadata.originalUrl`), else `sha256(title + body)`
 * so a URL-less Doc dedups on its text.
 */
export function itemId(doc: Doc): string {
    const url = doc.sourceUri ?? originalUrlFromMetadata(doc.metadata);
    if (url !== undefined && url.trim() !== '') {
        return sha256Hex(canonicalUrl(url));
    }
    return sha256Hex(`${doc.title ?? ''}${doc.body}`);
}

/** The canonical URL a Doc resolves to, or `undefined` when it has no usable URL. */
export function canonicalUrlForDoc(doc: Doc): string | undefined {
    const url = doc.sourceUri ?? originalUrlFromMetadata(doc.metadata);
    if (url === undefined || url.trim() === '') return undefined;
    return canonicalUrl(url);
}

/** An http(s) URL in free text; the class stops at the characters that delimit one in prose. */
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]}]+/gi;
/** Sentence punctuation that trails a URL in prose or a markdown link. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/**
 * Every canonicalized http(s) URL referenced in `text`, deduped.
 *
 * This is the item's outbound identity: a link post carries the URL of the source it is about, so
 * `storyIdForUrls` can cluster the two even though their titles share no token (0316 R1).
 * Canonicalizing here is what makes a tracking-decorated link match the plain one.
 */
export function outboundUrls(text: string): string[] {
    const found = new Set<string>();
    for (const match of text.matchAll(URL_IN_TEXT)) {
        const trimmed = match[0].replace(TRAILING_PUNCTUATION, '');
        if (trimmed !== '') found.add(canonicalUrl(trimmed));
    }
    return [...found];
}
