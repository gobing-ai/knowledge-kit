/**
 * Bearer-authenticated microfeed `/api/v1/` REST client (design D1).
 * Endpoints pinned to `vendors/microfeed/src/server/api/handlers.ts` +
 * `src/shared/ApiSchemas.ts`; every 4xx/5xx or transport fault throws a
 * diagnostic — never silent (R4).
 */

/** microfeed API responses are `apiItemInputSchema`-shaped loose objects. */
export type MicrofeedItemInput = Record<string, unknown>;
/** microfeed item output (`apiItemOutputSchema` shape). */
export type MicrofeedItem = Record<string, unknown>;
/** JSON Feed document (`apiFeedSchema` shape) returned by the feed and item-get endpoints. */
export interface MicrofeedFeed {
    items?: MicrofeedItem[];
    [key: string]: unknown;
}

/** Presigned upload target returned by `POST /api/v1/media_files/presigned_urls`. */
export interface PreparedUpload {
    presignedUrl: string;
    mediaUrl: string;
}

/** Timeout floor so a zero/negative `MICROFEED_TIMEOUT_MS` cannot hang forever. */
const MIN_TIMEOUT_MS = 1_000;
/** Default timeout for large audio uploads (design D4). */
const DEFAULT_TIMEOUT_MS = 300_000;

export function resolveTimeoutMs(raw: string | undefined): number {
    const parsed = raw === undefined ? Number.NaN : Number(raw);
    if (!Number.isFinite(parsed) || parsed < MIN_TIMEOUT_MS) {
        return DEFAULT_TIMEOUT_MS;
    }
    return parsed;
}

export class MicrofeedClient {
    private readonly baseUrl: string;
    private readonly apiKey: string;
    private readonly timeoutMs: number;

    constructor(baseUrl: string, apiKey: string, timeoutMs: number) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.apiKey = apiKey;
        this.timeoutMs = timeoutMs;
    }

    /** Canonical public URL fallback for an item page (`{base}/items/{id}`). */
    public itemUrl(itemId: string): string {
        return `${this.baseUrl}/items/${itemId}`;
    }

    private async request(path: string, init: RequestInit & { body?: string | Uint8Array }): Promise<unknown> {
        let response: Response;
        try {
            response = await fetch(`${this.baseUrl}${path}`, {
                ...init,
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    Origin: this.baseUrl, // Astro CSRF origin check rejects cross-site form-like methods (DELETE/PUT/POST)
                    ...init.headers,
                },
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new Error(`microfeed transport error (${init.method ?? 'GET'} ${path}): ${reason}`);
        }

        if (!response.ok) {
            const text = (await response.text()).slice(0, 1000);
            let detail = text.trim();
            try {
                const parsed = JSON.parse(text) as { error?: unknown };
                if (typeof parsed.error === 'string') detail = parsed.error;
            } catch {
                // keep raw text as the detail
            }
            throw new Error(
                `microfeed API request failed (HTTP ${response.status} ${response.statusText} ${path}): ${detail || 'Unknown error'}`,
            );
        }

        try {
            return await response.json();
        } catch {
            throw new Error(`microfeed API returned a non-JSON response from ${path}`);
        }
    }

    /** `POST /api/v1/items` → `{id}`; 201 with optional 24h idempotent create (design D3). */
    public async createItem(input: MicrofeedItemInput, idempotencyKey?: string): Promise<string> {
        const data = (await this.request('/api/v1/items', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
            },
            body: JSON.stringify(input),
        })) as { id?: unknown };
        if (typeof data.id !== 'string' || data.id.length === 0) {
            throw new Error('microfeed item create response is missing the item id');
        }
        return data.id;
    }

    /** `POST /api/v1/items/validate` → `{valid: true}`; 400s surface as thrown diagnostics. */
    public async validateItem(input: MicrofeedItemInput): Promise<void> {
        await this.request('/api/v1/items/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        });
    }

    /**
     * `GET /api/v1/items/{itemId}` — returns the JSON Feed document limited to
     * that item (the endpoint serves the feed shape, items[0] is the item).
     */
    public async getItem(itemId: string): Promise<MicrofeedFeed> {
        return (await this.request(`/api/v1/items/${encodeURIComponent(itemId)}`, {
            method: 'GET',
        })) as MicrofeedFeed;
    }

    /** `PUT /api/v1/items/{itemId}` → the updated public item (includes `url` when live). */
    public async updateItem(itemId: string, input: MicrofeedItemInput): Promise<MicrofeedItem> {
        return (await this.request(`/api/v1/items/${encodeURIComponent(itemId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        })) as MicrofeedItem;
    }

    /**
     * `DELETE /api/v1/items/{itemId}` → `{}` (404s surface as thrown diagnostics).
     * Sends a JSON Content-Type: Astro 7 checkOrigin 403s non-safe methods without
     * one when no Origin header is present (task 0087).
     */
    public async deleteItem(itemId: string): Promise<void> {
        await this.request(`/api/v1/items/${encodeURIComponent(itemId)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
        });
    }

    /** `GET /api/v1/feed` — the full JSON Feed document. */
    public async listItems(): Promise<MicrofeedFeed> {
        return (await this.request('/api/v1/feed', { method: 'GET' })) as MicrofeedFeed;
    }

    /**
     * `POST /api/v1/media_files/presigned_urls` — audio uploads require `item_id`
     * (handlers.ts `prepareApiMediaUpload`), so the draft item must exist first (design D2);
     * image uploads (`category: 'image'`) presign without an item.
     */
    public async prepareUpload(input: {
        category: 'audio' | 'image';
        full_local_file_path: string;
        item_id?: string;
        size?: number;
        type?: string;
    }): Promise<PreparedUpload> {
        const data = (await this.request('/api/v1/media_files/presigned_urls', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        })) as { presigned_url?: unknown; media_url?: unknown };
        if (typeof data.presigned_url !== 'string' || typeof data.media_url !== 'string') {
            throw new Error('microfeed upload-preparation response is missing presigned_url/media_url');
        }
        return { presignedUrl: data.presigned_url, mediaUrl: data.media_url };
    }

    /** `PUT <presigned_url>` — raw audio bytes, same-origin. */
    public async uploadBytes(presignedUrl: string, bytes: Uint8Array, mimeType: string): Promise<void> {
        let response: Response;
        try {
            response = await fetch(presignedUrl, {
                method: 'PUT',
                headers: { 'Content-Type': mimeType },
                body: bytes,
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new Error(`microfeed transport error (PUT audio bytes): ${reason}`);
        }
        if (!response.ok) {
            const text = (await response.text()).slice(0, 1000);
            throw new Error(
                `microfeed audio upload failed (HTTP ${response.status} ${response.statusText}): ${text.trim() || 'Unknown error'}`,
            );
        }
    }
}
