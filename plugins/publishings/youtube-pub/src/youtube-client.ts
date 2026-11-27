import { extname } from 'node:path';
import { type Content, type Result, ResultSchema, videoGenContentSchema } from '@gobing-ai/kk-core';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { credentialSecrets, loadYouTubeCredentials, redact, type YouTubeCredentials } from './credentials';

/**
 * YouTube Data API v3 upload client for `youtube-pub`.
 *
 * Two HTTP calls, no SDK (design §5.3): an OAuth2 refresh against `oauth2.googleapis.com`, then the
 * resumable `videos.insert` (init → PUT bytes to the returned `Location`). Everything is refused
 * before the first fetch when the payload or the credentials are unusable (R3).
 */

const TARGET = 'youtube-pub';
/** Google's OAuth2 token endpoint. */
export const YOUTUBE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Resumable-upload init for `videos.insert` (snippet + status parts). */
export const YOUTUBE_UPLOAD_URL =
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

/** YouTube's own limits: title characters, and the Shorts ceiling this plugin accepts (R4). */
export const YOUTUBE_TITLE_MAX = 100;
export const YOUTUBE_SHORTS_MAX_SEC = 180;

/** Per-request deadlines (R5): a token call is quick, an upload scales with the file. */
export const TOKEN_TIMEOUT_MS = 30_000;
export const UPLOAD_MIN_TIMEOUT_MS = 600_000;
/** Assumed floor throughput for the upload deadline, in bytes per second (~400 kbit/s). */
export const UPLOAD_FLOOR_BYTES_PER_SEC = 50_000;

/** Privacy the upload may declare; anything else is refused (private stays the default). */
export const YOUTUBE_PRIVACY_VALUES = ['private', 'unlisted', 'public'] as const;
export type YouTubePrivacy = (typeof YOUTUBE_PRIVACY_VALUES)[number];

/** Client construction seam: every external edge is injectable for offline tests. */
export interface YouTubeClientOptions {
    fetchImpl?: typeof fetch;
    env?: Record<string, string | undefined>;
    home?: string;
    fs?: FileSystem;
    /** Bypasses the credentials loader entirely (tests and already-resolved callers). */
    credentials?: YouTubeCredentials;
}

/** Fetch-shaped function the client calls; `typeof fetch` with the signal always set. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Body text of a response, empty when the body cannot be read (never throws). */
async function readText(response: Response): Promise<string> {
    try {
        return await response.text();
    } catch {
        return '';
    }
}

/** Body JSON of a response, `null` when it is absent or unparseable (never throws). */
async function readJson(response: Response): Promise<unknown> {
    try {
        return (await response.json()) as unknown;
    } catch {
        return null;
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

/** Bounded single-line rendering of an operator value for a refusal message. */
function bounded(value: unknown): string {
    return String(value).replace(/\s+/g, ' ').slice(0, 120);
}

/** Upload deadline: at least ten minutes, more for a large file (R5). */
export function uploadTimeoutMs(sizeBytes: number): number {
    const transferMs = Math.ceil((Number.isFinite(sizeBytes) ? sizeBytes : 0) / UPLOAD_FLOOR_BYTES_PER_SEC) * 1000;
    return Math.max(UPLOAD_MIN_TIMEOUT_MS, transferMs);
}

/** THE Shorts description: the body plus the `#Shorts` marker, never twice (R4). */
export function shortsDescription(body: string): string {
    const trimmed = body.trim();
    if (trimmed === '') return '#Shorts';
    return /#shorts\b/i.test(trimmed) ? trimmed : `${trimmed}\n\n#Shorts`;
}

/** The public Shorts URL for an uploaded id (R4). */
export function shortsUrl(videoId: string): string {
    return `https://youtube.com/shorts/${videoId}`;
}

/**
 * The resumable-upload init body: snippet from the Content, status private-first with the
 * kids declaration YouTube requires (R4).
 */
export function buildUploadBody(args: {
    title: string;
    description: string;
    tags?: string[];
    privacyStatus: YouTubePrivacy;
    /** 0452 R6: a lip-synced synthetic presenter must be declared to YouTube. */
    containsSyntheticMedia?: boolean;
}): Record<string, unknown> {
    return {
        snippet: {
            title: args.title,
            description: args.description,
            ...(args.tags === undefined || args.tags.length === 0 ? {} : { tags: args.tags }),
        },
        status: {
            privacyStatus: args.privacyStatus,
            selfDeclaredMadeForKids: false,
            embeddable: true,
            // Verified in the Data API v3 `videos` resource reference (2026-11-27):
            // `status.containsSyntheticMedia` is the disclosure flag for altered/synthetic content.
            ...(args.containsSyntheticMedia === true ? { containsSyntheticMedia: true } : {}),
        },
    };
}

export class YouTubeClient {
    private readonly fetchImpl: FetchLike;
    private readonly fs: FileSystem;
    private readonly options: YouTubeClientOptions;
    private credentials: YouTubeCredentials | undefined;

    constructor(options: YouTubeClientOptions = {}) {
        this.options = options;
        this.fetchImpl = (options.fetchImpl ?? globalThis.fetch) as FetchLike;
        this.fs = options.fs ?? createNodeFileSystem();
        this.credentials = options.credentials;
    }

    /** Refusals carry no secret: every message goes through `redact` (R5). */
    private fail(message: string, credentials?: YouTubeCredentials): Result {
        return ResultSchema.parse({
            ok: false,
            target: TARGET,
            error: redact(message, credentialSecrets(credentials ?? this.credentials)),
        });
    }

    /** The refusal ladder R3 owes before any fetch, plus the shared validations it implies. */
    private async validate(
        content: Content,
    ): Promise<{ shape: ReturnType<typeof videoGenContentSchema.parse> } | { error: string }> {
        const parsed = videoGenContentSchema.safeParse(content);
        if (!parsed.success) {
            return {
                error: `youtube-pub requires a video-gen Content payload: ${parsed.error.issues
                    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
                    .join('; ')}`,
            };
        }
        const shape = parsed.data;
        if (shape.metadata.height <= shape.metadata.width) {
            return {
                error: `youtube-pub needs a vertical 9:16 video: got ${shape.metadata.width}x${shape.metadata.height}`,
            };
        }
        if (shape.metadata.durationSec > YOUTUBE_SHORTS_MAX_SEC) {
            return {
                error: `youtube-pub accepts Shorts of at most ${YOUTUBE_SHORTS_MAX_SEC}s: got ${shape.metadata.durationSec}s`,
            };
        }
        if (extname(shape.metadata.videoPath).toLowerCase() !== '.mp4') {
            return { error: `youtube-pub uploads MP4 only: got ${bounded(shape.metadata.videoPath)}` };
        }
        const stats = await this.fs.stat(shape.metadata.videoPath);
        if (stats === null || !stats.isFile() || stats.size <= 0) {
            return { error: `youtube-pub cannot read the video at ${bounded(shape.metadata.videoPath)}` };
        }
        return { shape };
    }

    /** Resolve credentials lazily so a payload refusal never touches config (R3). */
    private resolveCredentials(): { credentials: YouTubeCredentials } | { error: string } {
        if (this.credentials !== undefined) return { credentials: this.credentials };
        const loaded = loadYouTubeCredentials({ env: this.options.env, home: this.options.home });
        if ('error' in loaded) return loaded;
        this.credentials = loaded.credentials;
        return loaded;
    }

    /** Exchange the refresh token for an access token (one POST, 30s deadline). */
    private async accessToken(credentials: YouTubeCredentials): Promise<string | { error: string }> {
        const body = new URLSearchParams({
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
            refresh_token: credentials.refreshToken,
            grant_type: 'refresh_token',
        });
        let response: Response;
        try {
            response = await this.fetchImpl(YOUTUBE_TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString(),
                signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
            });
        } catch {
            return { error: 'youtube-pub token refresh failed (network error or timeout)' };
        }
        if (!response.ok) {
            return { error: `youtube-pub token refresh refused (HTTP ${response.status})` };
        }
        const payload = asRecord(await readJson(response));
        const token = typeof payload?.access_token === 'string' ? payload.access_token : '';
        if (token === '') return { error: 'youtube-pub token refresh returned no access_token' };
        return token;
    }

    /**
     * Publish one video. Returns a `Result`; never throws for a refusal (R3/R4), and a successful
     * upload reports the Shorts URL and the video id.
     */
    async publish(content: Content, options?: Record<string, unknown>): Promise<Result> {
        const validated = await this.validate(content);
        if ('error' in validated) return this.fail(validated.error);
        const { shape } = validated;

        // R4: `options.privacyStatus` is the ONLY switch; private stays the default. Reading a
        // same-named `metadata` key would let an arbitrary payload flip a safety default.
        const requestedPrivacy = options?.privacyStatus as unknown;
        if (
            requestedPrivacy !== undefined &&
            !(YOUTUBE_PRIVACY_VALUES as readonly unknown[]).includes(requestedPrivacy)
        ) {
            return this.fail(
                `youtube-pub privacyStatus '${bounded(requestedPrivacy)}' is not one of ${YOUTUBE_PRIVACY_VALUES.join(', ')}`,
            );
        }
        const privacy: YouTubePrivacy = (requestedPrivacy as YouTubePrivacy | undefined) ?? 'private';

        const title = (shape.title ?? '').trim();
        if (title === '') return this.fail('youtube-pub requires a non-empty Content.title (the snippet title)');
        if (title.length > YOUTUBE_TITLE_MAX) {
            return this.fail(`youtube-pub title is ${title.length} chars; YouTube accepts ≤${YOUTUBE_TITLE_MAX}`);
        }

        const loaded = this.resolveCredentials();
        if ('error' in loaded) return this.fail(loaded.error);
        const credentials = loaded.credentials;

        const videoPath = shape.metadata.videoPath;
        let bytes: ArrayBuffer;
        try {
            bytes = await Bun.file(videoPath).arrayBuffer();
        } catch {
            return this.fail(`youtube-pub cannot read the video at ${bounded(videoPath)}`);
        }
        if (bytes.byteLength === 0) return this.fail(`youtube-pub cannot read the video at ${bounded(videoPath)}`);

        const tags = shape.metadata.tags;
        const token = await this.accessToken(credentials);
        if (typeof token !== 'string') return this.fail(token.error, credentials);

        const body = buildUploadBody({
            title,
            description: shortsDescription(shape.body),
            ...(tags === undefined ? {} : { tags }),
            privacyStatus: privacy,
            // A synthetic presenter marks the video; the metadata key is video-gen's 0452 flag.
            containsSyntheticMedia: shape.metadata.syntheticPresenter === true,
        });

        const init = await this.initUpload(token, body, bytes.byteLength);
        if ('error' in init) return this.fail(init.error, credentials);

        const uploaded = await this.putBytes(init.location, bytes);
        if ('error' in uploaded) return this.fail(uploaded.error, credentials);

        const videoId = uploaded.videoId;
        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            id: videoId,
            url: shortsUrl(videoId),
            message: `youtube-pub uploaded ${videoId} as ${privacy}`,
            metadata: { privacyStatus: privacy, videoId },
        });
    }

    /** Resumable init → the `Location` the bytes go to. */
    private async initUpload(
        token: string,
        body: Record<string, unknown>,
        sizeBytes: number,
    ): Promise<{ location: string } | { error: string }> {
        let response: Response;
        try {
            response = await this.fetchImpl(YOUTUBE_UPLOAD_URL, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json; charset=UTF-8',
                    'X-Upload-Content-Length': String(sizeBytes),
                    'X-Upload-Content-Type': 'video/mp4',
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
            });
        } catch {
            return { error: 'youtube-pub upload init failed (network error or timeout)' };
        }
        if (!response.ok) {
            const detail = await readText(response);
            const quota = response.status === 403 && /quota/i.test(detail);
            return {
                error: `youtube-pub upload init refused (HTTP ${response.status}${quota ? ' quotaExceeded' : ''})`,
            };
        }
        const location = response.headers.get('location') ?? response.headers.get('Location') ?? '';
        if (location === '') {
            return { error: 'youtube-pub upload init returned no Location header' };
        }
        return { location };
    }

    /** PUT the MP4 bytes to the session URI and read the video id back. */
    private async putBytes(location: string, bytes: ArrayBuffer): Promise<{ videoId: string } | { error: string }> {
        let response: Response;
        try {
            response = await this.fetchImpl(location, {
                method: 'PUT',
                headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.byteLength) },
                body: new Uint8Array(bytes),
                signal: AbortSignal.timeout(uploadTimeoutMs(bytes.byteLength)),
            });
        } catch {
            return { error: 'youtube-pub upload failed (network error or timeout)' };
        }
        if (!response.ok) {
            return { error: `youtube-pub upload refused (HTTP ${response.status})` };
        }
        const payload = asRecord(await readJson(response));
        const videoId = typeof payload?.id === 'string' ? payload.id : '';
        if (videoId === '') return { error: 'youtube-pub upload returned no video id' };
        return { videoId };
    }
}
