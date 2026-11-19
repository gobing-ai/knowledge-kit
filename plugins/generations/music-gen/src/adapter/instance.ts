import { detectAudioFormat } from '../audio';
import type { AudioFormat, MusicModel } from '../brief';
import type { MusicGenerateRequest } from '../request';

/**
 * Live adapter for the self-hosted Lyria 3 instance (task 0398 R2/R3; contract
 * frozen by `docs/design/music-gen.md` §6).
 *
 * This is the only module in the plugin that knows HTTP. Everything downstream
 * sees a typed take in and a typed `Content` out.
 *
 * **Paid-call policy (§6.3) — the whole reason this file exists.** Both
 * `POST /api/lyria/generate` and `POST /api/ai/analyze` are non-idempotent: the
 * instance may have billed and persisted a take even when kk never saw the
 * response. So:
 *
 * - connect-phase failures (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`,
 *   `EHOSTUNREACH`, `ENETUNREACH`, a connect-phase timeout) retry — bounded to
 *   {@link DEFAULT_CONNECT_ATTEMPTS} total attempts — because the request
 *   provably never reached the instance;
 * - `401/402/403/404/429` and the all-keys-rejected `502` are **terminal**: one
 *   request sent, no retry, the instance's own error text plus a remediation;
 * - a timeout after send, `ECONNRESET`, any other `5xx`, an unparseable `200`
 *   or a `200` carrying no audio are **ambiguous**: never re-send — reconcile
 *   against `GET /api/generations` and adopt the earliest matching take.
 *
 * The instance already fails over across its own key list and refuses to fail
 * over on request-level errors so an account is not billed twice, so kk adds no
 * second failover layer: only the two edges above.
 */

/** Injected HTTP seam. Tests supply a stub; nothing mutates a global. */
export type MusicFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Generate route (paid). */
export const GENERATE_PATH = '/api/lyria/generate';

/** Library route (free): the reconciliation + cache-first analyse source. */
export const LIBRARY_PATH = '/api/generations';

/** Analyse route (paid). */
export const ANALYZE_PATH = '/api/ai/analyze';

/** Bounded connect-phase attempts (§6.3: "bounded to 3 attempts total"). */
export const DEFAULT_CONNECT_ATTEMPTS = 3;

/** First connect-retry backoff in ms; doubles per attempt. Injected in tests to keep them fast. */
export const DEFAULT_RETRY_DELAY_MS = 250;

/** Statuses that are terminal post-send: the request was rejected, nothing was produced. */
const TERMINAL_STATUSES: ReadonlySet<number> = new Set([400, 401, 402, 403, 404, 429]);

/** Operator remediation per terminal status (§6.3 table). */
const STATUS_REMEDIATION: Readonly<Record<number, string>> = {
    400: 'fix the brief/request — the instance rejected the body and its own error text is above',
    401: 'fix the provider key on the instance (kk never sees or prints it)',
    402: 'the provider credits/entitlement on the instance are exhausted — top up or switch its key',
    403: 'the instance key is restricted for this project/model — widen it or use another key',
    404: 'check music.instance.url / KK_MUSIC_INSTANCE_URL and the model: the route or model does not exist there',
    429: 'the instance is rate limited — wait, then re-run; kk never retries a 429',
};

/** Fetch error codes that prove the request never reached the instance. */
const CONNECT_ERROR_CODES: ReadonlySet<string> = new Set([
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'UND_ERR_CONNECT_TIMEOUT',
]);

/** Fetch error codes that mean "the request may have landed" — ambiguous, never retried. */
const AMBIGUOUS_ERROR_CODES: ReadonlySet<string> = new Set([
    'ECONNRESET',
    'ECONNABORTED',
    'EPIPE',
    'UND_ERR_SOCKET',
    'ETIMEDOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
]);

/**
 * The instance's all-keys-rejected body marker (§6.3). The instance tries its
 * key list in order and answers `502` with this class of message when every key
 * it holds was rejected; that is terminal — a second kk attempt cannot help.
 */
export const ALL_KEYS_REJECTED_PATTERN =
    /all\b[^.]{0,60}?keys?\b|every\s+(?:api\s+|provider\s+)?key\b|no\s+(?:usable|valid|working)\s+(?:api\s+|provider\s+)?keys?\b|keys?\s+(?:were\s+|was\s+)?(?:all\s+)?rejected/i;

/** One library take as `GET /api/generations` reports it. Every field except `id` may be absent. */
export interface InstanceTake {
    id: string;
    prompt?: string;
    model?: MusicModel | string;
    generatedAt?: string;
    audioUrl?: string;
    /** The container the manifest claims; the delivered bytes are authoritative (§6.2). */
    format?: string;
    title?: string;
    language?: string;
    durationTarget?: string;
    batchCount?: number;
    /** The instance caches analysis per generation, so a take may already carry it (§6.3 / R3). */
    analysis?: MusicAnalysis;
}

/** The instance's analysis payload. Shape is the instance's own — kk only reads `summary`. */
export type MusicAnalysis = Record<string, unknown>;

/** One extra library take that matched reconciliation but was not adopted (recorded for spend visibility). */
export interface UnclaimedTake {
    id: string;
    generatedAt: string;
}

/** One produced take: the manifest, the delivered bytes and their detected container. */
export interface GeneratedTake {
    id: string;
    prompt: string;
    model: string;
    generatedAt?: string;
    audioUrl?: string;
    language?: string;
    durationTarget?: string;
    batchCount?: number;
    title?: string;
    analysis?: MusicAnalysis;
    bytes: Uint8Array;
    /** Detected from the bytes (§6.2) — never the requested `format`. */
    format: AudioFormat;
    contentType?: string;
    /** True when the take came from `GET /api/generations` after an ambiguous send. */
    adoptedByReconciliation: boolean;
    /** Later library takes that matched the same request: the operator can see the extra spend. */
    unclaimed: UnclaimedTake[];
    /** Wall clock of the whole generate call, reconciliation included. */
    elapsedMs: number;
}

/** Result of a cache-first analyse. */
export interface AnalysisOutcome {
    instanceId: string;
    /** `null` only when the instance answered but carried no analysis object. */
    analysis: MusicAnalysis | null;
    /** True when the manifest already carried the analysis: no paid POST was sent (R3). */
    cached: boolean;
    /** True when a paid POST was sent in this call (an adopted post-ambiguity analysis counts). */
    paid: boolean;
}

/** The surface every adapter (live, offline) implements. */
export interface MusicInstance {
    /** `lyria-instance` or `offline`; recorded in `Content.metadata` and the liner notes. */
    readonly provider: string;
    /** Issue one paid generate. Never re-sends after an ambiguous outcome. */
    generate(request: MusicGenerateRequest): Promise<GeneratedTake>;
    /** Read the instance library (`GET /api/generations`). */
    listGenerations(): Promise<InstanceTake[]>;
    /** Cache-first analyse: manifest analysis first, one paid POST only when absent. */
    analyze(instanceId: string): Promise<AnalysisOutcome>;
    /** Human-facing library URL for one generation, used in `Content.references`. */
    libraryUrl(instanceId: string): string;
}

/** How a failure behaves: terminal (one request, no retry), ambiguous (reconcile) or connect. */
export type InstanceFailureKind = 'terminal' | 'ambiguous' | 'connect';

/** Fields of an {@link InstanceError}. */
export interface InstanceErrorOptions {
    kind: InstanceFailureKind;
    /** Route, e.g. `POST /api/lyria/generate`. */
    endpoint: string;
    attempts: number;
    elapsedMs: number;
    status?: number;
    /** The instance's own error text, verbatim (truncated). */
    instanceMessage?: string;
    remediation: string;
    /** What happened, in one clause. */
    detail: string;
}

/**
 * A failed instance call. The message always names the endpoint, what happened,
 * the instance's own text when there is one, and the remediation.
 */
export class InstanceError extends Error {
    readonly kind: InstanceFailureKind;
    readonly endpoint: string;
    readonly attempts: number;
    readonly elapsedMs: number;
    readonly status: number | undefined;
    readonly instanceMessage: string | undefined;
    readonly remediation: string;

    constructor(options: InstanceErrorOptions) {
        const elapsed = `${String(options.elapsedMs)} ms`;
        const attemptWord = options.attempts === 1 ? 'attempt' : 'attempts';
        const status = options.status === undefined ? '' : ` ${String(options.status)}`;
        const instanceText = options.instanceMessage === undefined ? '' : `: ${options.instanceMessage}`;
        super(
            `lyria instance ${options.endpoint} ${options.detail}${status} after ${String(options.attempts)} ${attemptWord} (${elapsed})${instanceText} — ${options.remediation}`,
        );
        this.name = 'InstanceError';
        this.kind = options.kind;
        this.endpoint = options.endpoint;
        this.attempts = options.attempts;
        this.elapsedMs = options.elapsedMs;
        this.status = options.status;
        this.instanceMessage = options.instanceMessage;
        this.remediation = options.remediation;
    }
}

/** Options for {@link createInstanceClient}. */
export interface InstanceClientOptions {
    baseUrl?: string;
    timeoutMs?: number;
    connectTimeoutMs?: number;
    /** Injected HTTP seam; defaults to the platform `fetch`. */
    fetch?: MusicFetch;
    /** Total attempts for connect-phase failures on a paid route. */
    connectAttempts?: number;
    /** First connect-retry backoff in ms. */
    retryDelayMs?: number;
    /** Injected sleep (tests pass a no-op). */
    sleep?: (ms: number) => Promise<void>;
    /** Injected clock for elapsed-time reporting. */
    now?: () => number;
}

/** Raw HTTP response reduced to what the adapter needs. */
interface RawResponse {
    status: number;
    statusText: string;
    contentType?: string;
    headers: Headers;
    bytes: Uint8Array;
}

/** Outcome of one HTTP round trip. */
type AttemptOutcome =
    | { kind: 'response'; response: RawResponse }
    | { kind: 'connect'; reason: string }
    | { kind: 'ambiguous'; reason: string; status?: number };

/** Outcome of a whole send (connect retries included). */
type SendOutcome =
    | { kind: 'ok'; response: RawResponse; attempts: number }
    | { kind: 'terminal'; response: RawResponse; message: string; attempts: number }
    | { kind: 'ambiguous'; reason: string; status?: number; attempts: number }
    | { kind: 'connect-exhausted'; reason: string; attempts: number };

/** Extract a socket error code from a fetch rejection, if it has one. */
function errorCode(error: unknown): string | undefined {
    const direct = (error as { code?: unknown } | null)?.code;
    if (typeof direct === 'string') {
        return direct;
    }
    const cause = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
    return typeof cause === 'string' ? cause : undefined;
}

/** One-line description of a thrown fetch error, for diagnostics. */
function describeThrown(error: unknown): string {
    if (error instanceof Error) {
        const code = errorCode(error);
        return code === undefined ? `${error.name}: ${error.message}` : `${code} (${error.message})`;
    }
    return String(error);
}

/** Default sleep used between connect retries. */
function realSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The platform fetch, as the injected seam's default. */
const platformFetch: MusicFetch = fetch;

/** Read the instance's error text: JSON `message`/`error` when present, else the raw body. */
function instanceErrorText(response: RawResponse): string {
    const text = new TextDecoder().decode(response.bytes).trim();
    if (text === '') {
        return response.statusText === '' ? '(empty response body)' : response.statusText;
    }
    try {
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null) {
            const message = (parsed as { message?: unknown }).message;
            const error = (parsed as { error?: unknown }).error;
            const chosen = typeof message === 'string' ? message : typeof error === 'string' ? error : undefined;
            if (chosen !== undefined && chosen.trim() !== '') {
                return chosen.trim().slice(0, 500);
            }
        }
    } catch {
        // Not JSON: fall through to the raw text.
    }
    return text.slice(0, 500);
}

/** Coerce an unknown library payload into `InstanceTake[]`, or `null` when the shape is unusable. */
function parseLibrary(payload: unknown): InstanceTake[] | null {
    const list = Array.isArray(payload)
        ? payload
        : typeof payload === 'object' &&
            payload !== null &&
            Array.isArray((payload as { generations?: unknown }).generations)
          ? ((payload as { generations: unknown[] }).generations as unknown[])
          : Array.isArray((payload as { items?: unknown } | null)?.items)
            ? ((payload as { items: unknown[] }).items as unknown[])
            : null;
    if (list === null) {
        return null;
    }
    const takes: InstanceTake[] = [];
    for (const entry of list) {
        if (typeof entry !== 'object' || entry === null) {
            continue;
        }
        const record = entry as Record<string, unknown>;
        const id = record.id ?? record.generationId;
        if (typeof id !== 'string' || id === '') {
            continue;
        }
        takes.push({
            id,
            ...(typeof record.prompt === 'string' ? { prompt: record.prompt } : {}),
            ...(typeof record.model === 'string' ? { model: record.model } : {}),
            ...(typeof record.generatedAt === 'string' ? { generatedAt: record.generatedAt } : {}),
            ...(typeof record.audioUrl === 'string' ? { audioUrl: record.audioUrl } : {}),
            ...(typeof record.url === 'string' ? { audioUrl: record.url } : {}),
            ...(typeof record.format === 'string' ? { format: record.format } : {}),
            ...(typeof record.title === 'string' ? { title: record.title } : {}),
            ...(typeof record.language === 'string' ? { language: record.language } : {}),
            ...(typeof record.durationTarget === 'string' ? { durationTarget: record.durationTarget } : {}),
            ...(typeof record.batchCount === 'number' ? { batchCount: record.batchCount } : {}),
            ...(typeof record.analysis === 'object' && record.analysis !== null
                ? { analysis: record.analysis as MusicAnalysis }
                : {}),
        });
    }
    return takes;
}

/**
 * The live instance client. One instance per plugin run; all HTTP goes through
 * the injected {@link MusicFetch} seam so tests never open a socket.
 */
export class InstanceClient implements MusicInstance {
    readonly provider = 'lyria-instance';

    private readonly baseUrl: string;
    private readonly timeoutMs: number;
    private readonly connectTimeoutMs: number;
    private readonly fetchImpl: MusicFetch;
    private readonly connectAttempts: number;
    private readonly retryDelayMs: number;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly now: () => number;

    constructor(options: InstanceClientOptions = {}) {
        this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
        this.timeoutMs = options.timeoutMs ?? 180_000;
        this.connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
        this.fetchImpl = options.fetch ?? platformFetch;
        this.connectAttempts = Math.max(1, options.connectAttempts ?? DEFAULT_CONNECT_ATTEMPTS);
        this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
        this.sleep = options.sleep ?? realSleep;
        this.now = options.now ?? Date.now;
    }

    /** Absolute URL for a route or a manifest-supplied (possibly relative) audio URL. */
    private url(target: string): string {
        return new URL(target, `${this.baseUrl}/`).toString();
    }

    /** Library URL for one generation (the `Content.references` provenance link). */
    libraryUrl(instanceId: string): string {
        return new URL(`${LIBRARY_PATH}/${encodeURIComponent(instanceId)}`, `${this.baseUrl}/`).toString();
    }

    /** One round trip with a connect-phase deadline and an end-to-end deadline. */
    private async attempt(method: 'GET' | 'POST', path: string, body: unknown): Promise<AttemptOutcome> {
        const controller = new AbortController();
        let phase: 'connect' | 'body' = 'connect';
        let abortReason: 'connect-timeout' | 'generate-timeout' | undefined;
        const connectTimer = setTimeout(() => {
            if (phase === 'connect' && abortReason === undefined) {
                abortReason = 'connect-timeout';
                controller.abort();
            }
        }, this.connectTimeoutMs);
        const totalTimer = setTimeout(() => {
            if (abortReason === undefined) {
                abortReason = 'generate-timeout';
                controller.abort();
            }
        }, this.timeoutMs);
        try {
            const init: RequestInit = {
                method,
                headers: {
                    accept: 'application/json, audio/*',
                    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
                },
                signal: controller.signal,
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            };
            const response = await this.fetchImpl(this.url(path), init);
            // Headers arrived: the request reached the instance, so a later abort is post-send.
            phase = 'body';
            clearTimeout(connectTimer);
            const bytes = new Uint8Array(await response.arrayBuffer());
            const contentType = response.headers.get('content-type') ?? undefined;
            return {
                kind: 'response',
                response: {
                    status: response.status,
                    statusText: response.statusText,
                    ...(contentType === undefined ? {} : { contentType }),
                    headers: response.headers,
                    bytes,
                },
            };
        } catch (error) {
            const reason = describeThrown(error);
            if (abortReason === 'connect-timeout') {
                return { kind: 'connect', reason: `no connection within ${String(this.connectTimeoutMs)} ms` };
            }
            if (abortReason === 'generate-timeout') {
                return {
                    kind: 'ambiguous',
                    reason: `no response within the ${String(this.timeoutMs)} ms generation deadline`,
                };
            }
            const code = errorCode(error);
            if (code !== undefined && CONNECT_ERROR_CODES.has(code)) {
                return { kind: 'connect', reason };
            }
            if (code !== undefined && AMBIGUOUS_ERROR_CODES.has(code)) {
                // The request was sent and the connection broke: it may already be billed.
                return { kind: 'ambiguous', reason: `${code}: the connection broke after the request was sent` };
            }
            // Anything unrecognised may have reached the instance: ambiguous, never retried.
            return { kind: 'ambiguous', reason };
        } finally {
            clearTimeout(connectTimer);
            clearTimeout(totalTimer);
        }
    }

    /** Classify a received response against the terminal/ambiguous table (§6.3). */
    private classify(response: RawResponse, attempts: number): SendOutcome {
        const { status } = response;
        if (status >= 200 && status < 300) {
            return { kind: 'ok', response, attempts };
        }
        const message = instanceErrorText(response);
        if (status === 502 && ALL_KEYS_REJECTED_PATTERN.test(message)) {
            return { kind: 'terminal', response, message, attempts };
        }
        if (TERMINAL_STATUSES.has(status)) {
            return { kind: 'terminal', response, message, attempts };
        }
        if (status >= 500 || status === 408) {
            return {
                kind: 'ambiguous',
                reason: `answered ${String(status)} ${response.statusText}`.trim(),
                status,
                attempts,
            };
        }
        if (status >= 400) {
            // Any other 4xx is a post-send request rejection: nothing was produced, so no reconciliation.
            return { kind: 'terminal', response, message, attempts };
        }
        return { kind: 'ambiguous', reason: `answered an unexpected ${String(status)}`, status, attempts };
    }

    /** Send one request, retrying connect-phase failures only, and classify the result. */
    private async send(method: 'GET' | 'POST', path: string, body: unknown): Promise<SendOutcome> {
        const maxAttempts = method === 'POST' ? this.connectAttempts : 1;
        let attempts = 0;
        let lastReason = '';
        for (;;) {
            attempts += 1;
            const outcome = await this.attempt(method, path, body);
            if (outcome.kind === 'response') {
                return this.classify(outcome.response, attempts);
            }
            if (outcome.kind === 'ambiguous') {
                return {
                    kind: 'ambiguous',
                    reason: outcome.reason,
                    ...(outcome.status === undefined ? {} : { status: outcome.status }),
                    attempts,
                };
            }
            lastReason = outcome.reason;
            if (attempts >= maxAttempts) {
                return { kind: 'connect-exhausted', reason: lastReason, attempts };
            }
            await this.sleep(this.retryDelayMs * 2 ** (attempts - 1));
        }
    }

    /** Raised when every connect attempt failed: the request never reached the instance, so no spend. */
    private connectError(path: string, reason: string, attempts: number, elapsedMs: number): InstanceError {
        return new InstanceError({
            kind: 'connect',
            endpoint: `POST ${path}`,
            attempts,
            elapsedMs,
            detail: `could not be reached (${reason})`,
            remediation: 'start the instance, or fix music.instance.url / KK_MUSIC_INSTANCE_URL; nothing was billed',
        });
    }

    /** Raised for a terminal post-send rejection: the instance's own text plus a remediation. */
    private terminalError(
        path: string,
        response: RawResponse,
        message: string,
        attempts: number,
        elapsedMs: number,
    ): InstanceError {
        const remediation =
            response.status === 502
                ? 'every provider key the instance holds was rejected — fix its key list, then re-run'
                : (STATUS_REMEDIATION[response.status] ?? 'fix the request or the instance before re-running');
        return new InstanceError({
            kind: 'terminal',
            endpoint: `POST ${path}`,
            attempts,
            elapsedMs,
            status: response.status,
            instanceMessage: message,
            detail: 'rejected the request with',
            remediation,
        });
    }

    /** Read the library (free, idempotent). Throws {@link InstanceError} when it is unusable. */
    async listGenerations(): Promise<InstanceTake[]> {
        const startedAt = this.now();
        const outcome = await this.send('GET', LIBRARY_PATH, undefined);
        if (outcome.kind === 'connect-exhausted') {
            throw this.connectError(LIBRARY_PATH, outcome.reason, outcome.attempts, this.now() - startedAt);
        }
        if (outcome.kind === 'terminal' || outcome.kind === 'ambiguous') {
            throw new InstanceError({
                kind: outcome.kind === 'terminal' ? 'terminal' : 'ambiguous',
                endpoint: `GET ${LIBRARY_PATH}`,
                attempts: outcome.attempts,
                elapsedMs: this.now() - startedAt,
                ...(outcome.kind === 'terminal' ? { status: outcome.response.status } : {}),
                detail: 'could not be read',
                remediation: 'check the instance is healthy and music.instance.url / KK_MUSIC_INSTANCE_URL',
            });
        }
        let payload: unknown;
        try {
            payload = JSON.parse(new TextDecoder().decode(outcome.response.bytes));
        } catch {
            throw new InstanceError({
                kind: 'ambiguous',
                endpoint: `GET ${LIBRARY_PATH}`,
                attempts: outcome.attempts,
                elapsedMs: this.now() - startedAt,
                detail: 'returned unparseable JSON',
                remediation: 'check the instance version and the base URL; reconciliation needs the library',
            });
        }
        const takes = parseLibrary(payload);
        if (takes === null) {
            throw new InstanceError({
                kind: 'ambiguous',
                endpoint: `GET ${LIBRARY_PATH}`,
                attempts: outcome.attempts,
                elapsedMs: this.now() - startedAt,
                detail: 'did not carry a generation list',
                remediation: 'check the instance version: reconciliation reads `generations[]` from this route',
            });
        }
        return takes;
    }

    /** Fetch the audio bytes of one take; `null` when the take carries no audio URL. */
    private async fetchAudio(take: InstanceTake): Promise<{ bytes: Uint8Array; contentType?: string } | null> {
        if (take.audioUrl === undefined || take.audioUrl === '') {
            return null;
        }
        const outcome = await this.attempt('GET', take.audioUrl, undefined);
        if (outcome.kind !== 'response' || outcome.response.status < 200 || outcome.response.status >= 300) {
            return null;
        }
        return {
            bytes: outcome.response.bytes,
            ...(outcome.response.contentType === undefined ? {} : { contentType: outcome.response.contentType }),
        };
    }

    /** Build the generated take from a manifest plus its audio bytes; `null` when the bytes carry no audio. */
    private buildTake(
        manifest: InstanceTake,
        audio: { bytes: Uint8Array; contentType?: string },
        options: { elapsedMs: number; adoptedByReconciliation: boolean; unclaimed: UnclaimedTake[] },
    ): GeneratedTake | null {
        const format = detectAudioFormat(audio.bytes, audio.contentType);
        if (format === null) {
            return null;
        }
        return {
            id: manifest.id,
            prompt: manifest.prompt ?? '',
            model: manifest.model ?? '',
            ...(manifest.generatedAt === undefined ? {} : { generatedAt: manifest.generatedAt }),
            ...(manifest.audioUrl === undefined ? {} : { audioUrl: this.url(manifest.audioUrl) }),
            ...(manifest.language === undefined ? {} : { language: manifest.language }),
            ...(manifest.durationTarget === undefined ? {} : { durationTarget: manifest.durationTarget }),
            ...(manifest.batchCount === undefined ? {} : { batchCount: manifest.batchCount }),
            ...(manifest.title === undefined ? {} : { title: manifest.title }),
            ...(manifest.analysis === undefined ? {} : { analysis: manifest.analysis }),
            bytes: audio.bytes,
            format,
            ...(audio.contentType === undefined ? {} : { contentType: audio.contentType }),
            adoptedByReconciliation: options.adoptedByReconciliation,
            unclaimed: options.unclaimed,
            elapsedMs: options.elapsedMs,
        };
    }

    /**
     * Reconcile an ambiguous send against the library (§6.3): adopt the earliest
     * take whose prompt is byte-equal to what kk sent, whose model matches and
     * whose `generatedAt` is at or after the request start; record later matches
     * as `unclaimed`. Never re-sends the paid request.
     */
    private async reconcile(
        request: MusicGenerateRequest,
        startedAtMs: number,
        path: string,
        reason: string,
        attempts: number,
    ): Promise<GeneratedTake> {
        let library: InstanceTake[];
        try {
            library = await this.listGenerations();
        } catch {
            const elapsedMs = this.now() - startedAtMs;
            throw new InstanceError({
                kind: 'ambiguous',
                endpoint: `POST ${path}`,
                attempts,
                elapsedMs,
                detail: `did not return a response (${reason}) and GET ${LIBRARY_PATH} could not be read to reconcile`,
                remediation:
                    'the request may have been billed: check GET /api/generations on the instance before re-running, and re-run with --force only if no take appeared',
            });
        }
        const matches = library
            .filter((take) => {
                if (take.prompt !== request.prompt || take.model !== request.model) {
                    return false;
                }
                if (take.generatedAt === undefined) {
                    return false;
                }
                const generated = Date.parse(take.generatedAt);
                return Number.isFinite(generated) && generated >= startedAtMs;
            })
            .sort((left, right) => Date.parse(left.generatedAt ?? '') - Date.parse(right.generatedAt ?? ''));

        const [adopted, ...rest] = matches;
        const elapsedMs = this.now() - startedAtMs;
        if (adopted === undefined) {
            throw new InstanceError({
                kind: 'ambiguous',
                endpoint: `POST ${path}`,
                attempts,
                elapsedMs,
                detail: `did not return a response (${reason}) and GET ${LIBRARY_PATH} found no take whose prompt matches the sent prompt byte for byte`,
                remediation:
                    'the request may still be running on the instance or may have been billed: check GET /api/generations, then re-run with --force to send a new (paid) request',
            });
        }
        const audio = await this.fetchAudio(adopted);
        if (audio === null) {
            throw new InstanceError({
                kind: 'ambiguous',
                endpoint: `POST ${path}`,
                attempts,
                elapsedMs,
                detail: `did not return a response (${reason}); library take ${adopted.id} matched but its audio could not be read`,
                remediation: `check GET ${LIBRARY_PATH} for take ${adopted.id} and its audio URL, then re-run with --force only if the audio is gone`,
            });
        }
        const take = this.buildTake(adopted, audio, {
            elapsedMs,
            adoptedByReconciliation: true,
            unclaimed: rest.map((entry) => ({ id: entry.id, generatedAt: entry.generatedAt ?? '' })),
        });
        if (take === null) {
            throw new InstanceError({
                kind: 'ambiguous',
                endpoint: `POST ${path}`,
                attempts,
                elapsedMs,
                detail: `did not return a response (${reason}); library take ${adopted.id} matched but its audio bytes are not a recognisable audio container`,
                remediation: `check the audio of library take ${adopted.id}, then re-run with --force only if it is unusable`,
            });
        }
        return take;
    }

    /** Issue one paid generate (§6.2/§6.3). */
    async generate(request: MusicGenerateRequest): Promise<GeneratedTake> {
        const startedAtMs = this.now();
        const outcome = await this.send('POST', GENERATE_PATH, request);
        const elapsedMs = this.now() - startedAtMs;
        if (outcome.kind === 'connect-exhausted') {
            throw this.connectError(GENERATE_PATH, outcome.reason, outcome.attempts, elapsedMs);
        }
        if (outcome.kind === 'terminal') {
            throw this.terminalError(GENERATE_PATH, outcome.response, outcome.message, outcome.attempts, elapsedMs);
        }
        if (outcome.kind === 'ambiguous') {
            return this.reconcile(request, startedAtMs, GENERATE_PATH, outcome.reason, outcome.attempts);
        }
        const response = outcome.response;
        const inlineAudio = detectAudioFormat(response.bytes, response.contentType) !== null;
        const isJson = response.contentType?.includes('json') === true;
        let manifest: InstanceTake | null = null;
        let audio: { bytes: Uint8Array; contentType?: string } | null = null;
        if (inlineAudio && !isJson) {
            // Streaming shape: the body IS the audio, so the id must ride a header. Without one
            // the take exists but cannot be recorded — reconcile rather than invent an id.
            const id = response.headers.get('x-generation-id') ?? response.headers.get('x-generation');
            if (id === null || id === '') {
                return this.reconcile(
                    request,
                    startedAtMs,
                    GENERATE_PATH,
                    'returned audio bytes without a generation id header',
                    outcome.attempts,
                );
            }
            manifest = {
                id,
                prompt: request.prompt,
                model: request.model,
                ...(request.durationTarget === undefined ? {} : { durationTarget: request.durationTarget }),
                batchCount: request.batchCount,
                title: request.title,
            };
            audio = {
                bytes: response.bytes,
                ...(response.contentType === undefined ? {} : { contentType: response.contentType }),
            };
        } else {
            // Manifest shape: `{ ...manifest }` or `{ generation: { ...manifest } }`.
            let payload: unknown;
            try {
                payload = JSON.parse(new TextDecoder().decode(response.bytes));
            } catch {
                return this.reconcile(
                    request,
                    startedAtMs,
                    GENERATE_PATH,
                    'returned a 200 with unparseable JSON',
                    outcome.attempts,
                );
            }
            const wrapped =
                typeof payload === 'object' && payload !== null && 'generation' in payload
                    ? (payload as { generation?: unknown }).generation
                    : payload;
            const parsed = parseLibrary([wrapped])?.[0] ?? null;
            if (parsed === null) {
                return this.reconcile(
                    request,
                    startedAtMs,
                    GENERATE_PATH,
                    'returned a 200 without a generation id',
                    outcome.attempts,
                );
            }
            // The manifest may omit what kk sent; the request is the authoritative echo of it.
            manifest = {
                ...parsed,
                prompt: parsed.prompt ?? request.prompt,
                model: parsed.model ?? request.model,
            };
            const fetched = await this.fetchAudio(parsed);
            if (fetched === null) {
                return this.reconcile(
                    request,
                    startedAtMs,
                    GENERATE_PATH,
                    `returned a 200 for ${parsed.id} but its audio could not be fetched`,
                    outcome.attempts,
                );
            }
            audio = fetched;
        }
        const take = this.buildTake(manifest, audio, {
            elapsedMs: this.now() - startedAtMs,
            adoptedByReconciliation: false,
            unclaimed: [],
        });
        if (take === null) {
            return this.reconcile(
                request,
                startedAtMs,
                GENERATE_PATH,
                `returned a 200 for ${manifest.id} but the bytes are not a recognisable audio container`,
                outcome.attempts,
            );
        }
        return take;
    }

    /** Read the manifest analysis for one generation, or `undefined` when absent. */
    private async cachedAnalysis(instanceId: string): Promise<MusicAnalysis | undefined> {
        const library = await this.listGenerations();
        const take = library.find((entry) => entry.id === instanceId);
        return take?.analysis;
    }

    /**
     * Cache-first analyse (R3): the instance caches analysis per generation, so a
     * second paid analysis is pure waste. One paid POST only when the manifest
     * carries none; after an ambiguous POST the reconciliation is the same
     * manifest read — never a second paid call.
     */
    async analyze(instanceId: string): Promise<AnalysisOutcome> {
        const cached = await this.cachedAnalysis(instanceId);
        if (cached !== undefined) {
            return { instanceId, analysis: cached, cached: true, paid: false };
        }
        const startedAtMs = this.now();
        const outcome = await this.send('POST', ANALYZE_PATH, { id: instanceId });
        const elapsedMs = this.now() - startedAtMs;
        if (outcome.kind === 'connect-exhausted') {
            throw this.connectError(ANALYZE_PATH, outcome.reason, outcome.attempts, elapsedMs);
        }
        if (outcome.kind === 'terminal') {
            throw this.terminalError(ANALYZE_PATH, outcome.response, outcome.message, outcome.attempts, elapsedMs);
        }
        if (outcome.kind === 'ok') {
            let payload: unknown;
            try {
                payload = JSON.parse(new TextDecoder().decode(outcome.response.bytes));
            } catch {
                const adopted = await this.adoptAfterAmbiguity(
                    instanceId,
                    startedAtMs,
                    'returned a 200 with unparseable JSON',
                    outcome.attempts,
                );
                return adopted;
            }
            const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
            const analysis =
                typeof record.analysis === 'object' && record.analysis !== null
                    ? (record.analysis as MusicAnalysis)
                    : record;
            return { instanceId, analysis, cached: false, paid: true };
        }
        return await this.adoptAfterAmbiguity(instanceId, startedAtMs, outcome.reason, outcome.attempts);
    }

    /** Post-ambiguity analyse: adopt the manifest analysis when the instance cached it; else fail. */
    private async adoptAfterAmbiguity(
        instanceId: string,
        startedAtMs: number,
        reason: string,
        attempts: number,
    ): Promise<AnalysisOutcome> {
        const cached = await this.cachedAnalysis(instanceId).catch(() => undefined);
        if (cached !== undefined) {
            return { instanceId, analysis: cached, cached: true, paid: true };
        }
        const elapsedMs = this.now() - startedAtMs;
        throw new InstanceError({
            kind: 'ambiguous',
            endpoint: `POST ${ANALYZE_PATH}`,
            attempts,
            elapsedMs,
            detail: `did not return an analysis (${reason}) for generation ${instanceId}`,
            remediation:
                'the analysis may have been billed: check GET /api/generations for a cached analysis, then re-run with --force to pay for it again',
        });
    }
}

/** Build the live client. */
export function createInstanceClient(options: InstanceClientOptions = {}): InstanceClient {
    return new InstanceClient(options);
}
