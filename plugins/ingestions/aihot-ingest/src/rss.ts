import { createHash } from 'node:crypto';
import type { Doc } from '@gobing-ai/kk-core';

/**
 * RSS/Atom feed fetch + item → Doc mapping for the aihot-ingest RSS source.
 *
 * Why RSS (2026-09-08, dogfood): aihot.virxact.com's API served a 2020–2025 blog
 * archive — all 10 items were dropped every run by the workflow's 7-day freshness
 * gate, so the "curated" aihot source contributed zero usable items while carrying
 * the highest selection tier (SOURCE_BASE aihot=30, importance 4). The RSS source
 * restores aihot as a genuinely fresh feed; the API path stays selectable via
 * AIHOT_SOURCE=api for when the CMS has live curated content.
 *
 * Keeps metadata.source='aihot' so planEpisode's aihot tier (and importance base 4)
 * still applies to feed items.
 */

/** Default fresh AI-news feed (RSS 2.0, full text, reachable without auth).
 *
 * Why Ars Technica (2026-09-20, dogfood): the previous default (TechCrunch AI
 * category feed) stopped shipping `content:encoded` — items now carry only
 * 86–236-char `description` summaries. Every such body lands below the planner's
 * STUB_BODY_FLOOR (300 chars), scores quality 1, and is auto-rejected at
 * `qc_min_quality=2`, so the aihot leg contributed ~0 usable items (the
 * 2026-09-20 episode collapsed to 3 items / 5m33s). The Ars Technica AI feed
 * ships full `content:encoded` (≈900–1800 chars) on every item. The parser
 * already prefers `content:encoded`, so only the URL changes.
 */
export const AIHOT_FEED_URL_DEFAULT = 'https://arstechnica.com/ai/feed/';

export type RssFetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RssEntry {
    title: string;
    link: string;
    publishedAt: string | null; // ISO-8601 or null
    summary: string;
    category: string | null;
}

/** A numeric character reference, or the reference itself when it names no code point (feed text is untrusted). */
function codePoint(ref: string, value: number): string {
    return value <= 0x10ffff ? String.fromCodePoint(value) : ref;
}

/** Strip XML/HTML tags and normalize common entities to plain text. */
function stripMarkup(raw: string): string {
    return (
        raw
            .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            // Ars sends `&#039;` (zero-padded), which a literal `&#39;` missed (2026-11-25 run report).
            .replace(/&#(\d+);/g, (ref, dec: string) => codePoint(ref, Number(dec)))
            .replace(/&#x([0-9a-f]+);/gi, (ref, hex: string) => codePoint(ref, Number.parseInt(hex, 16)))
            // Last, so `&amp;lt;` decodes once to `&lt;` instead of twice to `<`.
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim()
    );
}

/** RSS <pubDate> (RFC 822) or Atom <published>/<updated> (ISO-8601) → ISO-8601. */
function toIsoDate(raw: string | undefined): string | null {
    if (!raw?.trim()) return null;
    const t = Date.parse(raw.trim().replace('UT', 'GMT'));
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Extract a single sub-element's text from an element body. */
function subElement(body: string, tag: string): string | undefined {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
    const m = body.match(re);
    return m?.[1];
}

/** Extract a link: RSS <link>text</link> or Atom <link href="..."/> (first match wins). */
function subLink(body: string): string | undefined {
    const text = subElement(body, 'link');
    if (text?.trim()) return text.trim();
    const m = body.match(/<link[^>]*\bhref\s*=\s*"([^"]+)"/i);
    return m?.[1];
}

/** Block-split RSS <item>… or Atom <entry>… elements and map each to an RssEntry. */
export function parseFeed(xml: string): RssEntry[] {
    const blocks: string[] = [];
    const itemRe = /<item[\s>][\s\S]*?<\/item>/gi;
    const entryRe = /<entry[\s>][\s\S]*?<\/entry>/gi;
    let m = itemRe.exec(xml);
    while (m !== null) {
        blocks.push(m[0]);
        m = itemRe.exec(xml);
    }
    if (blocks.length === 0) {
        m = entryRe.exec(xml);
        while (m !== null) {
            blocks.push(m[0]);
            m = entryRe.exec(xml);
        }
    }
    return blocks.map((b) => {
        const title = stripMarkup(subElement(b, 'title') ?? '');
        const link = subLink(b) ?? '';
        const category = stripMarkup(subElement(b, 'category') ?? '') || null;
        const pubRaw = subElement(b, 'pubDate') ?? subElement(b, 'published') ?? subElement(b, 'updated');
        const summary = stripMarkup(
            subElement(b, 'content:encoded') ?? subElement(b, 'description') ?? subElement(b, 'summary') ?? title,
        );
        return { title, link, publishedAt: toIsoDate(pubRaw), summary, category };
    });
}

export function computeRssDocId(seed: string): string {
    return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

/** Map a feed entry to the kk Doc shape; source:'aihot' keeps the aihot plan tier. */
export function mapRssEntryToDoc(entry: RssEntry, feedUrl: string): Doc {
    const id = entry.link ? computeRssDocId(entry.link) : computeRssDocId(`${entry.title}${entry.summary}`);
    let sourceName = 'aihot-feed';
    try {
        sourceName = new URL(feedUrl).hostname;
    } catch {
        // keep 'aihot-feed' fallback
    }
    return {
        id,
        title: entry.title || 'Untitled AI News',
        sourceUri: entry.link || feedUrl,
        body: `${entry.title}\n\n${entry.summary}\n`,
        mediaType: 'text/markdown',
        metadata: {
            source: 'aihot',
            sourceName,
            publishedAt: entry.publishedAt ?? undefined,
            discoveredAt: new Date().toISOString(),
            originalUrl: entry.link || undefined,
            category: entry.category ?? undefined,
        },
    };
}

export async function fetchRssDocs(
    feedUrl: string,
    limit: number,
    fetchLike: RssFetchLike = fetch,
): Promise<{ docs: Doc[]; asOf: string }> {
    const res = await fetchLike(feedUrl, {
        headers: { 'user-agent': 'aihot-ingest/1.0.0 (RSS source)' },
    });
    if (!res.ok) {
        throw new Error(`aihot-ingest RSS fetch failed: HTTP ${res.status} from ${feedUrl}`);
    }
    const xml = await res.text();
    const entries = parseFeed(xml);
    // Feed order is newest-first for RSS; atom may vary — prefer publication order.
    const seen = new Set<string>();
    const docs: Doc[] = [];
    for (const entry of entries) {
        if (docs.length >= limit) break;
        const key = entry.link || entry.title;
        if (seen.has(key)) continue;
        seen.add(key);
        docs.push(mapRssEntryToDoc(entry, feedUrl));
    }
    return { docs, asOf: new Date().toISOString() };
}
