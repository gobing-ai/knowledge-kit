import { echoError } from '@gobing-ai/ts-utils';
import { z } from 'zod';

/** Per-request timeout (ms) for aihot HTTP calls — Bun's `fetch` has no default deadline (R5). */
const REQUEST_TIMEOUT_MS = 120_000;

export const AIHOT_BASE_URL = 'https://aihot.virxact.com';
export const DEFAULT_AIHOT_USER_AGENT = 'aihot-ingest/1.0.0';

export const AihotItemSchema = z.object({
    id: z.string(),
    title: z.string(),
    originalTitle: z.string().nullable(),
    summary: z.string().nullable(),
    source: z.object({ name: z.string() }),
    links: z.object({
        aihot: z.url(),
        original: z.url(),
    }),
    publishedAt: z.iso.datetime().nullable(),
    discoveredAt: z.iso.datetime(),
    category: z.string().nullable(),
    score: z.number().min(0).max(100).nullable(),
    selected: z.boolean(),
    reason: z.string().nullable().optional(),
    attribution: z
        .object({
            name: z.string(),
            url: z.url(),
        })
        .optional(),
});

export type AihotItem = z.infer<typeof AihotItemSchema>;

export const AihotSnapshotResponseSchema = z.object({
    schemaVersion: z.literal(1),
    asOf: z.iso.datetime(),
    fields: z.literal('default'),
    cursor: z.string(),
    count: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextPage: z.string().nullable(),
    items: z.array(AihotItemSchema),
});

export type AihotSnapshotResponse = z.infer<typeof AihotSnapshotResponseSchema>;

const AihotSnapshotEnvelopeSchema = AihotSnapshotResponseSchema.extend({
    items: z.array(z.unknown()),
});

export const AihotChangeSchema = z.discriminatedUnion('op', [
    z.object({
        op: z.literal('upsert'),
        item: AihotItemSchema,
        changedAt: z.iso.datetime(),
    }),
    z.object({
        op: z.literal('remove'),
        id: z.string(),
        changedAt: z.iso.datetime(),
    }),
]);

export const AihotChangesResponseSchema = z.object({
    schemaVersion: z.literal(1),
    fields: z.literal('default'),
    cursor: z.string(),
    count: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    changes: z.array(AihotChangeSchema),
});

export type AihotChangesResponse = z.infer<typeof AihotChangesResponseSchema>;

const AihotChangesEnvelopeSchema = AihotChangesResponseSchema.extend({
    changes: z.array(z.unknown()),
});

export type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface AihotDeps {
    fetch: FetchLike;
    baseUrl?: string;
    userAgent?: string;
    warn?: (message: string) => void;
}

export interface FetchSnapshotOptions {
    limit?: number;
    page?: string;
}

export interface FetchChangesOptions {
    cursor: string;
    limit?: number;
}

export class AihotClient {
    private readonly fetch: FetchLike;
    private readonly baseUrl: string;
    private readonly userAgent: string;
    private readonly warn: (message: string) => void;

    constructor(deps?: Partial<AihotDeps>) {
        this.fetch = deps?.fetch ?? globalThis.fetch;
        this.baseUrl = (deps?.baseUrl ?? AIHOT_BASE_URL).replace(/\/+$/, '');
        this.userAgent = deps?.userAgent ?? DEFAULT_AIHOT_USER_AGENT;
        this.warn = deps?.warn ?? echoError;
    }

    public async fetchSnapshot(options?: FetchSnapshotOptions): Promise<AihotSnapshotResponse> {
        const url = new URL(`${this.baseUrl}/api/v1/selected/snapshot`);
        if (options?.limit !== undefined) {
            url.searchParams.set('limit', String(options.limit));
        }
        if (options?.page) {
            url.searchParams.set('page', options.page);
        }
        url.searchParams.set('fields', 'default');

        const res = await this.fetch(url.toString(), {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'User-Agent': this.userAgent,
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) {
            const errBody = (await res.text()).slice(0, 1000);
            throw new Error(
                `aihot snapshot request failed (HTTP ${res.status} ${res.statusText}): ${errBody || 'Unknown error'}`,
            );
        }

        const response = AihotSnapshotEnvelopeSchema.parse(await res.json());
        return {
            ...response,
            items: this.parseRecords(response.items, AihotItemSchema, 'snapshot item'),
        };
    }

    public async fetchChanges(options: FetchChangesOptions): Promise<AihotChangesResponse> {
        const url = new URL(`${this.baseUrl}/api/v1/selected/changes`);
        url.searchParams.set('cursor', options.cursor);
        if (options.limit !== undefined) {
            url.searchParams.set('limit', String(options.limit));
        }

        const res = await this.fetch(url.toString(), {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'User-Agent': this.userAgent,
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) {
            const errBody = (await res.text()).slice(0, 1000);
            throw new Error(
                `aihot changes request failed (HTTP ${res.status} ${res.statusText}): ${errBody || 'Unknown error'}`,
            );
        }

        const response = AihotChangesEnvelopeSchema.parse(await res.json());
        return {
            ...response,
            changes: this.parseRecords(response.changes, AihotChangeSchema, 'change record'),
        };
    }

    private parseRecords<T>(records: unknown[], schema: z.ZodType<T>, label: string): T[] {
        return records.flatMap((record, index) => {
            const result = schema.safeParse(record);
            if (result.success) return [result.data];

            const details = result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`);
            this.warn(`aihot: skipping invalid ${label} at index ${index} (${details.join('; ')})`);
            return [];
        });
    }
}

export function createAihotClient(deps?: Partial<AihotDeps>): AihotClient {
    return new AihotClient(deps);
}
