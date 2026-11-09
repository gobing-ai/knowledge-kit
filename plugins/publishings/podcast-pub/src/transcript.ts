/**
 * Transcript cues from real measured data (design docs/design/podcast-transcript.md).
 *
 * Inert today: the audio chain (voice-gen `concatWavs`, the daily sectioned ffmpeg join,
 * `dailyIntro`) does not record measured absolute offsets, and the intro sting plus
 * inter-segment silences are invisible to per-clip durations — so summed durations cannot be
 * used for cue timing. A transcript is built ONLY when every segment carries a measured
 * absolute `startSeconds`/`endSeconds` recorded against the final mixed episode plus real
 * text. Until the concat step records those offsets, this returns undefined and the publish
 * payload simply omits `_microfeed.podcast.transcripts`. Nothing here touches the network.
 */

/**
 * One segment from `metadata.segments[]` in **final-mixed-episode coordinates** (the shape the
 * concat step must record; per-clip `duration` values are deliberately NOT an input here —
 * summed durations never derive cue starts).
 */
export interface TranscriptSegmentInput {
    /** Measured absolute start of the segment's speech in the mixed episode. */
    startSeconds?: number;
    /**
     * Optional measured absolute end. Only the LAST segment's `endSeconds` is read (the final
     * cue boundary); earlier cue ends come from the next segment's measured start.
     */
    endSeconds?: number;
    transcription?: string;
}

/** Framed cue: `[start, end)` seconds in final-mixed coordinates and the caption text. */
export interface TranscriptCue {
    start: number;
    end: number;
    text: string;
}

function isMeasured(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Builds one cue per segment ONLY when every segment carries a measured absolute
 * `startSeconds` (strictly increasing) and the LAST segment carries a measured absolute
 * `endSeconds`, plus a non-empty transcription on every segment. Each cue start is the
 * segment's own measured offset — never a sum of per-clip durations — and each end is the
 * next measured boundary. Any missing/invalid value discards the whole transcript
 * (undefined); a partially timed transcript is not shippable.
 */
export function buildTranscriptSegments(segments: TranscriptSegmentInput[]): TranscriptCue[] | undefined {
    if (segments.length === 0) return undefined;
    for (const segment of segments) {
        if (!isMeasured(segment.startSeconds) || segment.startSeconds < 0) return undefined;
        const text = typeof segment.transcription === 'string' ? segment.transcription.trim() : '';
        if (text.length === 0) return undefined;
    }
    for (let index = 1; index < segments.length; index += 1) {
        if (
            (segments[index] as { startSeconds: number }).startSeconds <=
            (segments[index - 1] as { startSeconds: number }).startSeconds
        ) {
            return undefined;
        }
    }
    const last = segments[segments.length - 1] as { startSeconds: number; endSeconds?: number };
    if (!isMeasured(last.endSeconds) || last.endSeconds <= last.startSeconds) return undefined;
    return segments.map((segment, index) => ({
        start: segment.startSeconds as number,
        end:
            index === segments.length - 1
                ? (segment.endSeconds as number)
                : (segments[index + 1] as { startSeconds: number }).startSeconds,
        text: (segment.transcription as string).trim(),
    }));
}

function splitTimestamp(seconds: number): { hours: number; minutes: string; secs: string; fraction: string } {
    const totalMs = Math.round((Number.isFinite(seconds) && seconds > 0 ? seconds : 0) * 1000);
    return {
        hours: Math.floor(totalMs / 3_600_000),
        minutes: String(Math.floor((totalMs % 3_600_000) / 60_000)).padStart(2, '0'),
        secs: String(Math.floor((totalMs % 60_000) / 1000)).padStart(2, '0'),
        fraction: String(totalMs % 1000).padStart(3, '0'),
    };
}

/** `HH:MM:SS.mmm` — WebVTT requires two-digit hours. */
function vttTimestamp(seconds: number): string {
    const t = splitTimestamp(seconds);
    return `${String(t.hours).padStart(2, '0')}:${t.minutes}:${t.secs}.${t.fraction}`;
}

/** `HH:MM:SS,mmm` — SubRip twin of the VTT stamp with a comma decimal separator. */
function srtTimestamp(seconds: number): string {
    const t = splitTimestamp(seconds);
    return `${String(t.hours).padStart(2, '0')}:${t.minutes}:${t.secs},${t.fraction}`;
}

/**
 * WebVTT escaping per spec: `&` first, then `<`/`>` (the two characters a WebVTT parser treats
 * as markup). CR characters are dropped so text lines stay inline.
 */
function escapeVttText(text: string): string {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/\r+/g, '');
}

/** WebVTT document: `WEBVTT` header, then one cue per segment (overview cues omitted deliberately). */
export function renderWebVtt(cues: TranscriptCue[]): string {
    const lines = ['WEBVTT', ''];
    for (const cue of cues) {
        lines.push(`${vttTimestamp(cue.start)} --> ${vttTimestamp(cue.end)}`, escapeVttText(cue.text), '');
    }
    return lines.join('\n');
}

/** SubRip twin of {@link renderWebVtt}: numbered cues, `,` decimal separator, no header. */
export function renderSrt(cues: TranscriptCue[]): string {
    const lines: string[] = [];
    let number = 1;
    for (const cue of cues) {
        lines.push(
            String(number),
            `${srtTimestamp(cue.start)} --> ${srtTimestamp(cue.end)}`,
            escapeVttText(cue.text),
            '',
        );
        number += 1;
    }
    return lines.join('\n');
}

/** microfeed 1.0.13 transcript entry: HTTPS URL only, `text/plain` is not accepted. */
export interface TranscriptReference {
    url: string;
    type: 'text/vtt' | 'application/x-subrip';
    language: string;
}

export interface TranscriptConfig {
    /** `PODCAST_PUB_TRANSCRIPT` / `metadata.podcast.transcriptEnabled` — default false. */
    enabled: boolean;
    /** Already-hosted HTTPS URL (`PODCAST_PUB_TRANSCRIPT_URL` / `metadata.podcast.transcriptUrl`). */
    url?: string;
}

function podcastRecord(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
    if (metadata !== null && typeof metadata === 'object') {
        const podcast = metadata.podcast;
        if (podcast !== null && typeof podcast === 'object' && !Array.isArray(podcast)) {
            return podcast as Record<string, unknown>;
        }
    }
    return {};
}

function pick(metadata: Record<string, unknown>, key: string, envValue: string | undefined): unknown {
    if (Object.hasOwn(metadata, key)) {
        const value = metadata[key];
        if (value !== undefined && value !== '') return value;
    }
    return envValue !== undefined && envValue !== '' ? envValue : undefined;
}

/**
 * `metadata.podcast.*` wins over env (the plugin's established precedence, `src/seo.ts` pick).
 * A non-HTTPS or non-string URL fails loud before any request; flag on without a URL disables
 * the transcript with a warning instead of an error.
 */
export function resolveTranscriptConfig(
    metadata: Record<string, unknown> | undefined,
    env: NodeJS.ProcessEnv = process.env,
): { config: TranscriptConfig } | { error: string } {
    const podcast = podcastRecord(metadata);
    const rawEnabled = pick(podcast, 'transcriptEnabled', env.PODCAST_PUB_TRANSCRIPT);
    const enabled = rawEnabled === true || rawEnabled === 'true' || rawEnabled === '1';
    if (rawEnabled !== undefined && !enabled) {
        if (rawEnabled !== false && rawEnabled !== 'false' && rawEnabled !== '0') {
            return {
                error: `invalid transcript enable flag "${String(rawEnabled)}": expected PODCAST_PUB_TRANSCRIPT or metadata.podcast.transcriptEnabled to be true or false`,
            };
        }
    }
    const rawUrl = pick(podcast, 'transcriptUrl', env.PODCAST_PUB_TRANSCRIPT_URL);
    if (rawUrl === undefined) return { config: { enabled } };
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : String(rawUrl).trim();
    if (!url.startsWith('https://')) {
        return {
            error: `invalid transcript URL "${url}": microfeed hosts only HTTPS transcript files (set metadata.podcast.transcriptUrl or PODCAST_PUB_TRANSCRIPT_URL to an https:// URL)`,
        };
    }
    return { config: { enabled, url } };
}

/** The `_microfeed.podcast.transcripts` value for a real hosted VTT (zh-cn episodes). */
export function transcriptReferences(url: string): TranscriptReference[] {
    return [{ url, type: 'text/vtt', language: 'zh-cn' }];
}
