/**
 * 0394 R1/R16 — where a rendered citation may legitimately point.
 *
 * The ingest hop writes three independent provenance slots (`horizon-ingest/src/index.ts:125`):
 *
 *   `sourceUri`            the headline URL the digest linked — the *retrieval* destination.
 *   `metadata.source`      the collector classification from the digest's source line
 *                          (`hackernews · user1 · …`), i.e. the transport, not a publisher.
 *   `metadata.references`  the `<details>References</details>` links — item-specific evidence.
 *
 * The editorial renderer used to print `metadata.source` beside `sourceUri`, so a link that lands
 * on `example.com/alpha` was labelled `hackernews` and an aggregator permalink was labelled as if
 * it were the publisher. This module resolves the pair the renderer may emit, without guessing:
 *
 *  1. A retrieval URL that is a known discussion/aggregator platform page is a *transport*: one
 *     off-origin reference then corroborates an original → cite that reference, labelled by its own
 *     host (the identity is read from the URL that is actually linked, never inferred). A reference
 *     that itself lands on a known aggregator host is another transport page, never an original, so
 *     it can never corroborate one.
 *  2. Otherwise cite the retrieval URL. A publisher's own page is already the verifiable origin and
 *     stays authoritative — a secondary reference is not allowed to displace it. The label is the
 *     collector classification only when that classification corroborates the destination host
 *     (existing taxonomy preserved), else the host.
 *  3. A retrieval URL that is a known discussion/aggregator platform page is labelled explicitly
 *     (`docs/tasks/0394`, "when an aggregator is the only verifiable source, label it explicitly").
 *  4. No http(s) candidate at all → `null`; the caller renders no link (unchanged behaviour).
 *
 * Deliberately absent: redirect fetching, publisher-name inference, and any URL backfill. An
 * ambiguous reference set declines to pick — two different off-origin origins prove nothing.
 */

/** How the resolved link was chosen. Reported by audit tooling; never part of the rendered text. */
export type CitationKind = 'direct' | 'original' | 'aggregator-fallback';

export interface SourceCitation {
    /** The `href` the citation links to: a corroborated original, else the retrieval URL. */
    url: string;
    /** The link text: a host (or a corroborated classification), plus the marker when aggregator. */
    label: string;
    kind: CitationKind;
}

/**
 * Marker appended to a link that is known to be a transport/aggregator page rather than the
 * publisher's own page. Mechanical, not editorial wording — the writer skill owns prose.
 */
export const AGGREGATOR_MARKER = '（聚合）';

/**
 * The platforms whose pages aggregate someone else's article, keyed by the collector classification
 * the digest source line carries (`hackernews · user1 · … · [Discussion](…)`). Only the two transports
 * this corpus actually emits are listed; an unknown classification never makes a host an aggregator,
 * because that would be a guess (0394 design, "no guessed publishers").
 */
const AGGREGATOR_HOSTS: Readonly<Record<string, readonly string[]>> = {
    hackernews: ['news.ycombinator.com'],
    reddit: ['reddit.com', 'old.reddit.com', 'redd.it'],
};

const HTTP_URL = /^https?:\/\//i;

/** A trimmed `http(s)` URL, or `null` — the only scheme a citation may carry. */
function httpUrl(raw: unknown): URL | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!HTTP_URL.test(trimmed)) return null;
    try {
        return new URL(trimmed);
    } catch {
        return null;
    }
}

/** Host identity for a label: lowercased, `www.` stripped — the same normalisation the renderer used. */
function hostOf(url: URL): string {
    return url.hostname.toLowerCase().replace(/^www\./, '');
}

/** `metadata.source` as the collector classification, or `''` when absent/blank/non-string. */
function classificationOf(doc: Record<string, unknown> | null | undefined): string {
    const meta = doc?.metadata;
    if (meta === null || typeof meta !== 'object') return '';
    const source = (meta as Record<string, unknown>).source;
    return typeof source === 'string' ? source.trim() : '';
}

/** `metadata.references`, http(s) only, de-duplicated by URL — the item-specific evidence set. */
function referenceUrls(doc: Record<string, unknown> | null | undefined): string[] {
    const meta = doc?.metadata;
    if (meta === null || typeof meta !== 'object') return [];
    const raw = (meta as Record<string, unknown>).references;
    if (!Array.isArray(raw)) return [];
    const urls: string[] = [];
    for (const entry of raw) {
        const url = httpUrl(entry);
        if (url !== null && !urls.includes(url.toString())) urls.push(url.toString());
    }
    return urls;
}

/** Does the collector classification describe this destination? (`openai.com` ~ `openai.com`). */
function corroborates(classification: string, host: string): boolean {
    if (classification === '') return false;
    const normalized = classification
        .toLowerCase()
        .replace(HTTP_URL, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '');
    return normalized !== '' && (host === normalized || host.endsWith(`.${normalized}`));
}

/** Does `host` sit under one of these platform domains? */
function matchesAggregatorHost(hosts: readonly string[], host: string): boolean {
    return hosts.some((aggregator) => host === aggregator || host.endsWith(`.${aggregator}`));
}

/** Is this host the transport platform the classification names (a page about someone else's item)? */
function isAggregator(classification: string, host: string): boolean {
    const hosts = AGGREGATOR_HOSTS[classification.toLowerCase()];
    return hosts !== undefined && matchesAggregatorHost(hosts, host);
}

/**
 * Is this host *any* platform in the aggregator table, whatever the classification says? The
 * classification only decides the marker (rule 3); for corroboration the host alone says "transport",
 * because an unclassified permalink on a known aggregator is still not an original.
 */
function isKnownAggregatorHost(host: string): boolean {
    return Object.values(AGGREGATOR_HOSTS).some((hosts) => matchesAggregatorHost(hosts, host));
}

/** Cite the retrieval URL: corroborated classification, else the verified host; aggregator marked. */
function citeRetrieval(url: URL, classification: string): SourceCitation {
    const host = hostOf(url);
    if (isAggregator(classification, host)) {
        return { url: url.toString(), label: `${host}${AGGREGATOR_MARKER}`, kind: 'aggregator-fallback' };
    }
    return { url: url.toString(), label: corroborates(classification, host) ? classification : host, kind: 'direct' };
}

/**
 * Resolve the one citation a rendered item may carry. `null` means "no verifiable link" — the
 * caller emits no source line, exactly as before this change.
 */
export function resolveSourceCitation(
    doc: Record<string, unknown> | null | undefined,
    sourceUri: unknown,
): SourceCitation | null {
    const classification = classificationOf(doc);
    const retrieval = httpUrl(sourceUri);
    if (retrieval === null) {
        // No retrieval URL: a usable reference is still evidence, and its host is its identity — but a
        // reference that is itself a transport page keeps the aggregator marker (never a bare original).
        const references = referenceUrls(doc)
            .map((raw) => httpUrl(raw))
            .filter((url): url is URL => url !== null);
        const original = references.find((url) => !isKnownAggregatorHost(hostOf(url)));
        if (original !== undefined) {
            return { url: original.toString(), label: hostOf(original), kind: 'original' };
        }
        const [transport] = references;
        if (transport === undefined) return null;
        const host = hostOf(transport);
        return {
            url: transport.toString(),
            label: `${host}${AGGREGATOR_MARKER}`,
            kind: 'aggregator-fallback',
        };
    }
    const origins = new Map<string, URL>();
    for (const raw of referenceUrls(doc)) {
        const url = httpUrl(raw);
        if (url === null || url.origin === retrieval.origin) continue;
        // A reference on a known aggregator host is someone else's transport page, not this item's
        // publisher: excluding it keeps an aggregator from being cited as a bare `original`.
        if (isKnownAggregatorHost(hostOf(url))) continue;
        if (!origins.has(url.origin)) origins.set(url.origin, url);
    }
    // Only a transport page is displaced: when the retrieval URL is already the publisher's own page,
    // that page is the verifiable origin and an off-origin reference must not replace it. Exactly one
    // off-origin origin corroborates; two or more prove nothing about which is the item's publisher.
    if (origins.size === 1 && isKnownAggregatorHost(hostOf(retrieval))) {
        const [url] = [...origins.values()] as [URL];
        return { url: url.toString(), label: hostOf(url), kind: 'original' };
    }
    return citeRetrieval(retrieval, classification);
}
