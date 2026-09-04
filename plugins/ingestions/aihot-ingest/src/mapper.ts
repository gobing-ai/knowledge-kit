import { createHash } from 'node:crypto';
import type { Doc } from '@gobing-ai/kk-core';
import type { AihotItem } from './client';

export function computeDocId(seed: string): string {
    return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

export function mapAihotItemToDoc(item: AihotItem): Doc {
    const rawId = item.id.trim();
    const canonicalSource = item.links.original || item.links.aihot || item.title || 'untitled';
    const id = rawId.length > 0 ? rawId : computeDocId(canonicalSource);

    const sourceUri = item.links?.original || item.links?.aihot || `https://aihot.virxact.com/items/${id}`;
    const title = item.title.trim() || 'Untitled AI News';
    const body = `${item.summary?.trim() || item.title.trim()}\n`;

    const metadata: Record<string, unknown> = {
        source: 'aihot',
        sourceName: item.source.name,
        publishedAt: item.publishedAt,
        discoveredAt: item.discoveredAt,
        category: item.category ?? undefined,
        score: item.score ?? undefined,
        aihotUrl: item.links.aihot,
        originalUrl: item.links.original,
        attribution: item.attribution,
        reason: item.reason ?? undefined,
    };

    return {
        id,
        title,
        sourceUri,
        body,
        mediaType: 'text/markdown',
        metadata,
    };
}

export function mapAihotItemsToDocs(items: AihotItem[]): Doc[] {
    return items.map(mapAihotItemToDoc);
}
