/**
 * Provider error classifier for image-gen runtime fallback (task 0164, feature D6).
 *
 * Leaf module — no imports, like `timeouts.ts`. `types.ts` builds the `PROVIDERS` registry from
 * value imports of every adapter, so anything a provider needs outside that cycle must live in its
 * own leaf; task 0166's retry loop (and any adapter later) can import this one safely.
 *
 * The adapters throw plain `Error`s with inconsistent messages: some carry a status
 * (`seedream HTTP 401: …`, `MiniMax API error (429): …`, `Google API error (403): …`,
 * `HuggingFace model loading (HTTP 503): …`), some carry none (`OpenAI API error: <body>`),
 * some name a missing key (`… requires ARK_API_KEY`), and request timeouts abort through
 * `AbortSignal` (see `timeouts.ts`) as DOMExceptions named `TimeoutError`/`AbortError`. Rather
 * than retyping all 13 adapters to a typed error (rejected in the task Q&A), the classifier reads
 * `err.name` plus the message, parsing statuses from the three shapes in use: `(NNN)`, `HTTP NNN`,
 * and a trailing `: NNN`. Test fixtures copy real adapter throw strings, so wording drift in an
 * adapter shows up as a test to update.
 *
 * First matching row wins, policy first: content-policy rejections often arrive as HTTP 400/403,
 * and they must never trigger a fallback (D6 R4). `unknown` stays fallback-eligible — most
 * unknowns are provider-specific request constraints (validate() size/ratio rules, "no image
 * data") another provider may satisfy (task Q&A).
 */

/** The retry decision classes the D6 fallback loop (0166) acts on. */
export type ProviderErrorClass = 'auth' | 'quota' | 'transient' | 'policy' | 'unknown';

/** Content-policy / safety / moderation rejections — checked first, they often arrive as 400/403. */
const POLICY_RE = /content[_ -]?policy|moderation|safety|sensitive|inappropriate|violat|blocked/i;
/** Credential wording; 401/403 statuses are checked separately. */
const AUTH_RE = /api[_ -]?key|unauthori[sz]ed|authenticat|forbidden|requires [A-Z_]+|is required/i;
/** Quota / spend / rate-limit wording; 402/429 statuses are checked separately. */
const QUOTA_RE = /quota|rate[_ -]?limit|insufficient|balance|billing|exceeded|too many requests/i;
/** Network / timeout wording (the `err.name` TimeoutError/AbortError check is separate). */
const TRANSIENT_RE = /timed? ?out|ECONNRESET|ETIMEDOUT|ECONNREFUSED|fetch failed|socket|model loading/i;

/** Abort names produced by `AbortSignal.timeout` and manual aborts (DOMException in Bun and Node). */
const TRANSIENT_NAMES: ReadonlySet<string> = new Set(['TimeoutError', 'AbortError']);

/**
 * HTTP statuses carried by the message, parsed from the three shapes adapters use: `(NNN)`
 * (`MiniMax API error (429): …`), `HTTP NNN` (`seedream HTTP 401: …`), and a trailing `: NNN`
 * (`Failed to download image from MiniMax: 401`). Response bodies and provider-specific codes are
 * deliberately not statuses.
 */
function statusesIn(message: string): number[] {
    const statuses: number[] = [];
    for (const match of message.matchAll(/\((\d{3})\)|HTTP\s+(\d{3})\b|:\s*(\d{3})\s*$/gi)) {
        const status = match[1] ?? match[2] ?? match[3];
        if (status !== undefined) statuses.push(Number(status));
    }
    return statuses;
}

/** Duck-typed read of `name`/`message`; never throws, and non-object values have neither. */
function partsOf(err: unknown): { readonly name: string; readonly message: string } {
    if (typeof err !== 'object' || err === null) return { name: '', message: '' };
    const candidate = err as { readonly name?: unknown; readonly message?: unknown };
    return {
        name: typeof candidate.name === 'string' ? candidate.name : '',
        message: typeof candidate.message === 'string' ? candidate.message : '',
    };
}

/**
 * Classify a thrown value for the D6 fallback decision. Pure: no I/O, no env, no provider imports.
 * Row order is load-bearing — policy → auth → quota → transient → unknown — and the function never
 * throws: non-object values and objects without string `name`/`message` classify as `unknown`.
 */
export function classifyProviderError(err: unknown): ProviderErrorClass {
    const parts = partsOf(err);
    const statuses = statusesIn(parts.message);
    if (POLICY_RE.test(parts.message)) return 'policy';
    if (statuses.some((status) => status === 401 || status === 403) || AUTH_RE.test(parts.message)) return 'auth';
    if (statuses.some((status) => status === 402 || status === 429) || QUOTA_RE.test(parts.message)) return 'quota';
    if (
        TRANSIENT_NAMES.has(parts.name) ||
        statuses.some((status) => status === 408 || (status >= 500 && status <= 599)) ||
        TRANSIENT_RE.test(parts.message)
    ) {
        return 'transient';
    }
    return 'unknown';
}

/**
 * Whether the D6 fallback loop may move to the next provider after this class. Only `policy` is
 * never eligible: a rejected prompt must not be re-asked to a second vendor (D6 R4 / AC1).
 */
export function isFallbackEligible(cls: ProviderErrorClass): boolean {
    return cls !== 'policy';
}

/**
 * 0269 R1: the classes a same-provider retry may act on. `transient` (HTTP 408/5xx,
 * timeout/abort, network wording) and `quota` (429/rate-limit heals with a short wait; billing
 * burns at most one bounded retry — task 0269 Q&A D2) are retried; `auth` (credentials do not
 * heal), `policy` (the prompt will not change), and `unknown` (a blind retry burns spend) never.
 */
export function isTransientRetry(cls: ProviderErrorClass): boolean {
    return cls === 'transient' || cls === 'quota';
}
