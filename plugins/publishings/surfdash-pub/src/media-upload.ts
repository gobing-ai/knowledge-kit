import { basename, extname } from 'node:path';

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface MicrofeedUploadOptions {
    baseUrl?: string;
    apiKey?: string;
    fetchImpl?: FetchLike;
}

function contentTypeForImage(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    return 'image/png';
}

async function readErrorBody(res: Response): Promise<string> {
    try {
        return (await res.text()).slice(0, 200);
    } catch {
        return '';
    }
}

/**
 * Upload a local cover image to Microfeed's media bucket (`podcast-media.salty.vip`) via its
 * presigned URL endpoint and return the public `https://` `media_url`.
 *
 * Used by `surfdash-pub` only as a fallback when a caller supplies a local cover path rather than a
 * pre-published podcast `imageUrl`, so `surfdash` never commits cover binaries to git.
 */
export async function uploadCoverToMicrofeed(filePath: string, options: MicrofeedUploadOptions = {}): Promise<string> {
    const baseUrl = (options.baseUrl ?? process.env.MICROFEED_BASE_URL ?? '').trim().replace(/\/$/, '');
    const apiKey = (options.apiKey ?? process.env.MICROFEED_API_KEY ?? '').trim();
    if (!baseUrl) {
        throw new Error('MICROFEED_BASE_URL is required to upload a local cover image to podcast-media');
    }
    if (!apiKey) {
        throw new Error('MICROFEED_API_KEY is required to upload a local cover image to podcast-media');
    }

    const mime = contentTypeForImage(filePath);
    const bytes = await Bun.file(filePath).arrayBuffer();
    const doFetch = options.fetchImpl ?? fetch;

    const presignRes = await doFetch(`${baseUrl}/api/v1/media_files/presigned_urls`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Origin: baseUrl,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            category: 'image',
            full_local_file_path: basename(filePath),
            size: bytes.byteLength,
            type: mime,
        }),
    });
    if (!presignRes.ok) {
        const body = await readErrorBody(presignRes);
        throw new Error(`Microfeed cover presign failed (${presignRes.status}): ${body}`);
    }
    const { presigned_url, media_url } = (await presignRes.json()) as {
        presigned_url?: string;
        media_url?: string;
    };
    if (!presigned_url || !media_url || !/^https:\/\//.test(media_url)) {
        throw new Error(`Microfeed cover presign returned incomplete media_url: ${String(media_url)}`);
    }

    const putRes = await doFetch(presigned_url, {
        method: 'PUT',
        headers: { 'Content-Type': mime },
        body: bytes,
    });
    if (!putRes.ok) {
        const body = await readErrorBody(putRes);
        throw new Error(`Microfeed cover PUT upload failed (${putRes.status}): ${body}`);
    }
    return media_url;
}
