import type { Content } from '@gobing-ai/kk-core';

/** Resolved episode fields derived from a Content payload (design D6). */
export interface EpisodeMapping {
    /** Episode title: `content.title`, else the first `#` heading, else validation error. */
    title: string;
    /** Episode show notes: `metadata.showNotes` (summary) or `content.body` verbatim. */
    contentHtml: string;
    /** microfeed item status; `metadata.status` when given, `published` by default. */
    status: string | number;
    /** Audio reference: local file (upload flow) or already-hosted URL (single create call). */
    audio: { kind: 'file'; path: string; mimeType: string } | { kind: 'url'; url: string; mimeType: string };
    /** Optional playback duration in seconds (`metadata.durationSeconds`). */
    durationSeconds?: number;
    /** Optional episode cover: absolute or remote URL (`metadata.coverImage` → microfeed `image`). */
    imageUrl?: string;
    /** Optional publish date as epoch ms (`metadata.publishedAt` ISO string or epoch). */
    datePublishedMs?: number;
    /** Optional public link for the episode (`metadata.articleUrl` → microfeed `url`). */
    link?: string;
    /** Podcast-directory fields (`metadata.itunes`) passed through to `_microfeed`. */
    itunes?: {
        title?: string;
        episodeType?: 'full' | 'trailer' | 'bonus';
        season?: number;
        episode?: number;
        explicit?: boolean;
        block?: boolean;
    };
}

/** Extension → audio MIME defaults; `metadata.mimeType` overrides. */
const AUDIO_MIME_BY_EXTENSION: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.flac': 'audio/flac',
    '.opus': 'audio/opus',
};

/**
 * Resolves the audio MIME type from `metadata.mimeType` or the file extension
 * (`.wav` → `audio/wav`); unknown extensions fall back to `application/octet-stream`.
 * The plugin never probes or transcodes audio (design anti-pattern) — metadata
 * carries what the caller knows.
 */
export function resolveAudioMimeType(reference: string, mimeType?: unknown): string {
    if (typeof mimeType === 'string' && mimeType.trim().length > 0) {
        return mimeType.trim();
    }
    const dot = reference.lastIndexOf('.');
    const extension = dot >= 0 ? reference.slice(dot).toLowerCase() : '';
    return AUDIO_MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/**
 * Maps Content + episode metadata into microfeed item fields (design D6).
 * Validates only the plugin's own requirements — title resolvable and exactly one
 * audio reference — before any network call (R5); microfeed's `validate` endpoint
 * and server 400s surface everything else (R4 error path).
 * Throws with a diagnostic when the Content is not publishable.
 */
export function mapContentToEpisode(content: Content): EpisodeMapping {
    const metadata = content.metadata ?? {};

    let title = content.title?.trim();
    if (!title) {
        const match = content.body.match(/^#\s+(.+)$/m);
        title = match?.[1]?.trim();
    }
    if (!title) {
        throw new Error('episode title is required: set content.title or start the body with a "# " heading');
    }

    const audioFile = typeof metadata.audioFile === 'string' ? metadata.audioFile.trim() : undefined;
    const audioUrl = typeof metadata.audioUrl === 'string' ? metadata.audioUrl.trim() : undefined;
    if (audioFile && audioUrl) {
        throw new Error('ambiguous audio reference: set either metadata.audioUrl or metadata.audioFile, not both');
    }
    if (!audioFile && !audioUrl) {
        throw new Error(
            'audio reference is required: set metadata.audioUrl (hosted) or metadata.audioFile (local path)',
        );
    }

    const duration = metadata.durationSeconds;
    if (duration !== undefined && (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0)) {
        throw new Error(`invalid metadata.durationSeconds: expected a nonnegative number, got ${String(duration)}`);
    }

    const status = metadata.status ?? 'published';
    if (typeof status !== 'string' && typeof status !== 'number') {
        throw new Error(`invalid metadata.status: expected a status name or number, got ${typeof status}`);
    }

    const showNotes = typeof metadata.showNotes === 'string' ? metadata.showNotes.trim() : undefined;

    const articleUrl = typeof metadata.articleUrl === 'string' ? metadata.articleUrl.trim() : undefined;
    const link = articleUrl && articleUrl.length > 0 ? articleUrl : undefined;
    const coverImage = typeof metadata.coverImage === 'string' ? metadata.coverImage.trim() : undefined;
    // microfeed keeps absolute/remote image URLs verbatim; a local cover file is not
    // uploadable via the `image` field, so only http(s) paths pass through.
    const imageUrl = coverImage?.startsWith('http') ? coverImage : undefined;

    let datePublishedMs: number | undefined;
    const publishedAt = metadata.publishedAt;
    if (typeof publishedAt === 'string' && publishedAt.length > 0) {
        const parsed = Date.parse(publishedAt);
        if (Number.isNaN(parsed)) {
            throw new Error(`invalid metadata.publishedAt: not an ISO date string: ${publishedAt}`);
        }
        datePublishedMs = parsed;
    } else if (typeof publishedAt === 'number' && Number.isFinite(publishedAt)) {
        datePublishedMs = publishedAt;
    }

    let itunes: EpisodeMapping['itunes'] | undefined;
    const rawItunes = metadata.itunes;
    if (rawItunes !== undefined && typeof rawItunes === 'object' && !Array.isArray(rawItunes)) {
        const rec = rawItunes as Record<string, unknown>;
        const episodeType = rec.episodeType;
        if (episodeType !== undefined && !['full', 'trailer', 'bonus'].includes(String(episodeType))) {
            throw new Error(`invalid metadata.itunes.episodeType: ${String(episodeType)}`);
        }
        itunes = {
            ...(typeof rec.title === 'string' ? { title: rec.title } : {}),
            ...(episodeType !== undefined ? { episodeType: episodeType as 'full' | 'trailer' | 'bonus' } : {}),
            ...(typeof rec.season === 'number' ? { season: rec.season } : {}),
            ...(typeof rec.episode === 'number' ? { episode: rec.episode } : {}),
            ...(typeof rec.explicit === 'boolean' ? { explicit: rec.explicit } : {}),
            ...(typeof rec.block === 'boolean' ? { block: rec.block } : {}),
        };
    }

    return {
        title,
        contentHtml: showNotes && showNotes.length > 0 ? showNotes : content.body,
        status,
        audio: audioFile
            ? { kind: 'file', path: audioFile, mimeType: resolveAudioMimeType(audioFile, metadata.mimeType) }
            : {
                  kind: 'url',
                  url: audioUrl as string,
                  mimeType: resolveAudioMimeType(audioUrl as string, metadata.mimeType),
              },
        durationSeconds: duration as number | undefined,
        ...(imageUrl ? { imageUrl } : {}),
        ...(datePublishedMs !== undefined ? { datePublishedMs } : {}),
        ...(link ? { link } : {}),
        ...(itunes !== undefined ? { itunes } : {}),
    };
}
