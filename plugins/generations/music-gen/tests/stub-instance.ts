import type {
    AnalysisOutcome,
    GeneratedTake,
    InstanceTake,
    MusicAnalysis,
    MusicFetch,
    MusicInstance,
} from '../src/adapter/instance';
import type { MusicGenerateRequest } from '../src/request';

/**
 * Offline fixtures for the 0398 adapter tests: an injected {@link MusicFetch}
 * stub (an injected seam, never a mutated global) and a stub {@link MusicInstance}
 * for the plugin-level tests. Nothing here opens a socket.
 */

/** One request the stub saw. */
export interface StubCall {
    method: string;
    url: string;
    /** Parsed JSON body, when there was one. */
    body?: unknown;
    init?: RequestInit;
}

/** A stub fetch plus the call log the assertions read. */
export interface StubFetch {
    fetch: MusicFetch;
    calls: StubCall[];
}

/**
 * Build a fetch stub. The route returns a `Response`, or throws to simulate a
 * network failure. Every call is logged, so "exactly one POST" is assertable.
 */
export function stubFetch(route: (call: StubCall, calls: StubCall[]) => Response | Promise<Response>): StubFetch {
    const calls: StubCall[] = [];
    const fetchImpl: MusicFetch = async (input, init) => {
        const raw = init?.body;
        const call: StubCall = {
            method: init?.method ?? 'GET',
            url: input,
            ...(typeof raw === 'string' ? { body: JSON.parse(raw) as unknown } : {}),
            ...(init === undefined ? {} : { init }),
        };
        calls.push(call);
        return await route(call, calls);
    };
    return { fetch: fetchImpl, calls };
}

/** Bytes that pass `detectAudioFormat` as MP3 (an ID3 tag followed by one frame sync). */
export function mp3Bytes(): Uint8Array {
    return new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xfb, 0x90, 0x00]);
}

/** A JSON response. */
export function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

/** A binary audio response. */
export function audioResponse(bytes: Uint8Array, contentType = 'audio/mpeg'): Response {
    return new Response(bytes, { status: 200, headers: { 'content-type': contentType } });
}

/** A fetch rejection carrying a socket error code (`ECONNREFUSED`, `ECONNRESET`, …). */
export function networkFailure(code: string): never {
    const error = new TypeError(`stub network failure (${code})`);
    (error as { code?: string }).code = code;
    throw error;
}

/**
 * A response whose headers arrive immediately and whose body never ends —
 * modelled as a post-send timeout: the abort signal errors the stream, exactly
 * like a socket that dies mid-body.
 */
export function hangingBody(init?: RequestInit): Response {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            init?.signal?.addEventListener('abort', () => {
                controller.error(new DOMException('aborted', 'AbortError'));
            });
        },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
}

/** A fetch that never answers at all — a connect-phase stall (no headers ever arrive). */
export function neverResponds(init?: RequestInit): Promise<Response> {
    return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
        });
    });
}

/** A clock that advances a fixed step per read, so `elapsedMs` is deterministic and non-zero. */
export function steppingClock(start = 1_700_000_000_000, step = 7): { now: () => number; start: number } {
    let current = start;
    return {
        start,
        now: () => {
            const value = current;
            current += step;
            return value;
        },
    };
}

/** The one-shot request a plugin test sends (clip, no duration target). */
export const CLIP_REQUEST_PROMPT =
    'Dusty lofi hip-hop at 78 BPM in D minor: vinyl crackle, upright bass, brushed kit, Rhodes chords.';

/** A library take as `GET /api/generations` reports it. */
export function libraryTake(overrides: Partial<InstanceTake> & { id: string }): InstanceTake {
    return {
        prompt: CLIP_REQUEST_PROMPT,
        model: 'clip',
        generatedAt: new Date(1_700_000_100_000).toISOString(),
        audioUrl: `/files/${overrides.id}.mp3`,
        ...overrides,
    };
}

/** A generated take for the plugin-level tests. */
export function generatedTake(request: MusicGenerateRequest, overrides: Partial<GeneratedTake> = {}): GeneratedTake {
    return {
        id: 'gen_1',
        prompt: request.prompt,
        model: request.model,
        ...(request.durationTarget === undefined ? {} : { durationTarget: request.durationTarget }),
        language: request.language,
        batchCount: request.batchCount,
        bytes: mp3Bytes(),
        format: 'mp3',
        contentType: 'audio/mpeg',
        adoptedByReconciliation: false,
        unclaimed: [],
        elapsedMs: 1,
        ...overrides,
    };
}

/** Everything a stub instance records about the requests it saw. */
export interface StubInstanceOptions {
    provider?: string;
    /** Override the take a generate produces. */
    take?: (request: MusicGenerateRequest, index: number) => GeneratedTake | Promise<GeneratedTake>;
    /** Override the analysis for `analyze()`. */
    analysis?: MusicAnalysis | null;
    libraryUrl?: (instanceId: string) => string;
}

/** A scripted {@link MusicInstance} for the plugin tests (no HTTP at all). */
export class StubInstance implements MusicInstance {
    readonly provider: string;
    readonly requests: MusicGenerateRequest[] = [];
    private readonly options: StubInstanceOptions;
    private count = 0;

    constructor(options: StubInstanceOptions = {}) {
        this.options = options;
        this.provider = options.provider ?? 'lyria-instance';
    }

    async generate(request: MusicGenerateRequest): Promise<GeneratedTake> {
        this.requests.push(request);
        const index = this.count;
        this.count += 1;
        if (this.options.take !== undefined) {
            return await this.options.take(request, index);
        }
        return generatedTake(request, { id: `gen_${String(index + 1)}` });
    }

    async listGenerations(): Promise<InstanceTake[]> {
        return [];
    }

    async analyze(instanceId: string): Promise<AnalysisOutcome> {
        return { instanceId, analysis: this.options.analysis ?? null, cached: false, paid: true };
    }

    libraryUrl(instanceId: string): string {
        return this.options.libraryUrl?.(instanceId) ?? `http://127.0.0.1:3000/api/generations/${instanceId}`;
    }
}
