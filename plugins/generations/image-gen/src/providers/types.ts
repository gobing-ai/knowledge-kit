/**
 * Task 0103 — the frozen `ImageProvider` contract: 0104 codes against it and the 12
 * baoyu-derived adapters implement it. Wire-speaking adapters are later tickets; this
 * file carries only the request/result types, the registry, and the selection order.
 *
 * Prior art: vendors/baoyu-skills/skills/baoyu-image-gen/scripts/ (MIT © 2026 Jim Liu).
 * The deliberate differences from baoyu's `ProviderModule` (scripts/main.ts:15-20) —
 * `ImageRequest` replaces `CliArgs`, `isAvailable()` and `supportsReferenceImages(model)`
 * are new, `ImageResult` wraps the bytes — are recorded in the task Design.
 */

import { createAgnes } from './agnes';
import { createAzure } from './azure';
import { createCodexCli } from './codex-cli';
import { createDashscope } from './dashscope';
import { createGoogle } from './google';
import { createHuggingface } from './huggingface';
import { createJimeng } from './jimeng';
import { createMinimax } from './minimax';
import { createOpenai } from './openai';
import { createOpenrouter } from './openrouter';
import { createReplicate } from './replicate';
import { createSeedream } from './seedream';
import { createZai } from './zai';

/** The two quality levels baoyu exposes (SKILL.md); every provider maps or ignores them. */
export type ImageQuality = 'normal' | '2k';

/** One generation request; a non-empty `referenceImages` means image-to-image (0105). */
export interface ImageRequest {
    prompt: string;
    model: string;
    /** e.g. '21:9' — from FormatPreset.aspectRatio (0102). */
    aspectRatio?: string;
    /**
     * Declared preset canvas (0182 R1). Sent only when the resolved provider's
     * `exactSize(model, width, height)` returns true — with `aspectRatio` omitted;
     * every other provider receives the aspect-only request shape and never sees them.
     */
    width?: number;
    height?: number;
    quality?: ImageQuality;
    /** From StylePreset.negative (0102); providers without negative prompts ignore it. */
    negative?: string;
    /** Absolute paths; empty or undefined = text-to-image. */
    referenceImages?: string[];
    /** Default 1. v1 rule: a caller wanting N images issues N calls; adapters return the first. */
    n?: number;
}

/** Adapters return bytes, never paths — 0104 owns file naming and writing. */
export interface ImageResult {
    bytes: Uint8Array;
    /** 'png' | 'jpg' | 'webp' — the provider decides. */
    extension: string;
    provider: string;
    model: string;
}

export interface ImageProvider {
    readonly name: string;
    defaultModel(): string;
    /**
     * Env-presence readiness — MUST NOT perform network or subprocess calls. A stale
     * key still passes; it surfaces as the adapter's own auth error at generate()
     * time, matching baoyu's throw-at-call-time behaviour (task Q&A, closed).
     */
    isAvailable(): boolean;
    /** Queryable ref-image capability; 0105 routes `--ref` work on this fact. */
    supportsReferenceImages(model: string): boolean;
    /**
     * Exact-size capability (0182 R1/R4): can this adapter deliver the exact pixel canvas
     * for this model? Absent = aspect-only — `processGeneratorIO` then sends only
     * `aspectRatio`, byte-for-byte as before 0182. Adapters opt in one at a time, on
     * measured evidence (task 0182 Q&A, closed).
     */
    exactSize?(model: string, width: number, height: number): boolean;
    /** Throw on an impossible combination (e.g. Imagen + referenceImages) before spending money. */
    validate?(req: ImageRequest): void;
    generate(req: ImageRequest): Promise<ImageResult>;
}

/**
 * Provider error classification for the runtime fallback loop (task 0164; consumed by 0166).
 * Declared in `./errors`, a leaf module like `./timeouts`, so adapters can classify throw sites
 * later without entering the registry import cycle.
 */
export type { ProviderErrorClass } from './errors';
export { classifyProviderError, isFallbackEligible, isTransientRetry } from './errors';

/** Injection seam for tests — mirrors `VoiceboxClientOptions.fetch` (voice-gen). */
/**
 * Default per-request timeout for every image-gen provider HTTP call. Defined in `./timeouts` (a
 * leaf module) and re-exported here so `types.ts` stays the public surface; see that file for why
 * it cannot be declared inline (import cycle → TDZ). Overridable per call via
 * `ProviderOptions.timeoutMs` (tests).
 */
export { PROVIDER_REQUEST_TIMEOUT_MS } from './timeouts';

export interface ProviderOptions {
    fetch?: typeof fetch;
    /** Environment consulted instead of process.env (tests). */
    env?: Record<string, string | undefined>;
    /** Per-request timeout override (tests). Defaults to {@link PROVIDER_REQUEST_TIMEOUT_MS}. */
    timeoutMs?: number;
}

export type ProviderFactory = (options?: ProviderOptions) => ImageProvider;

/** Env var consulted for the provider name when no explicit request is passed (selection step 2). */
const IMAGE_GEN_PROVIDER_ENV = 'IMAGE_GEN_PROVIDER';

/** Providers that may never be auto-selected, even if listed in AUTO_ORDER later (task 0103 R3). */
const NEVER_AUTO: ReadonlySet<string> = new Set(['codex-cli']);

/** Registry row: the availability facts an adapter must honour, verbatim from its baoyu source. */
interface ProviderSpec {
    readonly name: string;
    /** Env vars where any one present = usable (google's `A || B` fallback chains). */
    readonly env: readonly string[];
    /** Env vars where every one must be present (jimeng's access/secret key pair). */
    readonly envAll?: readonly string[];
    readonly defaultModel: string;
    /** Model fragments that accept reference images; omit = every model does; empty = none. */
    readonly refModels?: readonly string[];
    /** Replaces the missing-credential text when readiness is not an env var (codex-cli). */
    readonly note?: string;
}

type ProviderRegistration = ProviderSpec & { readonly create: ProviderFactory };

/** The 12 baoyu adapters, one row each (task 0103 R1 inventory). Keys sorted alphabetically. */
export const PROVIDERS: Readonly<Record<string, ProviderRegistration>> = {
    agnes: {
        name: 'agnes',
        env: ['AGNES_API_KEY'],
        defaultModel: 'agnes-image-2.1-flash',
        create: createAgnes,
    },
    azure: {
        name: 'azure',
        env: ['AZURE_OPENAI_API_KEY'],
        defaultModel: 'gpt-image-2',
        create: createAzure,
    },
    'codex-cli': {
        name: 'codex-cli',
        env: [],
        defaultModel: 'codex-image-gen',
        note: "requires the 'codex' CLI on PATH with an active login (never auto-selected)",
        create: createCodexCli,
    },
    dashscope: {
        name: 'dashscope',
        env: ['DASHSCOPE_API_KEY'],
        defaultModel: 'qwen-image-2.0-pro',
        refModels: ['wan2.7'],
        create: createDashscope,
    },
    google: {
        name: 'google',
        env: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
        defaultModel: 'gemini-3-pro-image',
        refModels: [
            'gemini-3-pro-image',
            'gemini-3.1-flash-image',
            'gemini-3-pro-image-preview',
            'gemini-3-flash-preview',
            'gemini-3.1-flash-image-preview',
        ],
        create: createGoogle,
    },
    huggingface: {
        name: 'huggingface',
        env: ['HUGGINGFACE_API_TOKEN'],
        defaultModel: 'stabilityai/stable-diffusion-xl-base-1.0',
        create: createHuggingface,
    },
    jimeng: {
        name: 'jimeng',
        env: [],
        envAll: ['JIMENG_ACCESS_KEY_ID', 'JIMENG_SECRET_ACCESS_KEY'],
        defaultModel: 'jimeng_t2i_v40',
        create: createJimeng,
    },
    minimax: {
        name: 'minimax',
        env: ['MINIMAX_API_KEY'],
        defaultModel: 'image-01',
        create: createMinimax,
    },
    openai: {
        name: 'openai',
        env: ['OPENAI_API_KEY'],
        defaultModel: 'gpt-image-2',
        refModels: ['gpt-image'],
        create: createOpenai,
    },
    openrouter: {
        name: 'openrouter',
        env: ['OPENROUTER_API_KEY'],
        defaultModel: 'google/gemini-3.1-flash-image',
        create: createOpenrouter,
    },
    replicate: {
        name: 'replicate',
        env: ['REPLICATE_API_TOKEN'],
        defaultModel: 'google/nano-banana-2',
        create: createReplicate,
    },
    seedream: {
        name: 'seedream',
        env: ['ARK_API_KEY'],
        defaultModel: 'doubao-seedream-5-0-260128',
        refModels: ['doubao-seedream-5-0', 'doubao-seedream-4-5-', 'doubao-seedream-4-0-'],
        // 0107: the first wire-speaking adapter — replaces the envOnly shell.
        create: createSeedream,
    },
    zai: {
        name: 'zai',
        env: ['ZAI_API_KEY', 'BIGMODEL_API_KEY'],
        defaultModel: 'glm-image',
        refModels: [],
        create: createZai,
    },
};

/** Frozen auto-selection priority (task 0103 Design). `codex-cli` is absent on purpose. */
export const AUTO_ORDER = [
    'huggingface',
    'google',
    'openai',
    'replicate',
    'openrouter',
    'dashscope',
    'seedream',
    'zai',
    'minimax',
    'jimeng',
    'azure',
    'agnes',
] as const;

/** Human-readable readiness requirement for one registry row. */
function envSummary(reg: ProviderRegistration): string {
    if (reg.note !== undefined) {
        return reg.note;
    }
    // env entries are any-of alternatives (' or '); envAll entries are all-required (' and ');
    // the two groups are both required when present (' and ' across groups).
    const groups: string[] = [];
    if (reg.env.length > 0) groups.push(reg.env.join(' or '));
    if (reg.envAll !== undefined && reg.envAll.length > 0) groups.push(reg.envAll.join(' and '));
    return groups.join(' and ');
}

function notConfiguredMessage(reg: ProviderRegistration): string {
    if (reg.note !== undefined) {
        return `Provider '${reg.name}' is not available: ${reg.note}`;
    }
    return `Provider '${reg.name}' is not configured: missing ${envSummary(reg)} (set it in plugins.generations.image-gen.env or process.env)`;
}

/**
 * Resolve which provider name a generation job uses. First match wins:
 * 1. `requested` — an explicit name from the job input; unknown throws listing all 12
 *    valid names, known-but-unconfigured throws naming the missing env var (no silent
 *    downgrade: that would change what the operator paid for).
 * 2. `IMAGE_GEN_PROVIDER` in the environment, same two failure rules.
 * 3. The first name in AUTO_ORDER whose provider `isAvailable()`.
 * 4. Nothing available → throw listing every provider with what each one needs.
 */
export function selectProvider(
    requested?: string,
    options?: {
        /** Environment consulted instead of process.env (tests). */
        env?: Record<string, string | undefined>;
        /** Availability override; default asks the registered provider's isAvailable(). */
        isAvailable?: (name: string) => boolean;
    },
): string {
    const env = options?.env ?? process.env;
    const available =
        options?.isAvailable ??
        ((name: string): boolean => {
            const reg = PROVIDERS[name];
            return reg?.create({ env }).isAvailable() ?? false;
        });
    const names = Object.keys(PROVIDERS).sort();

    const explicit = requested ?? env[IMAGE_GEN_PROVIDER_ENV];
    if (explicit !== undefined && explicit !== '') {
        const reg = PROVIDERS[explicit];
        if (reg === undefined) {
            throw new Error(`Unknown image provider '${explicit}'. Valid providers: ${names.join(', ')}`);
        }
        if (!available(reg.name)) {
            throw new Error(notConfiguredMessage(reg));
        }
        return reg.name;
    }

    for (const name of AUTO_ORDER) {
        if (!NEVER_AUTO.has(name) && available(name)) {
            return name;
        }
    }
    const wanted = names
        .map((name) => {
            const reg = PROVIDERS[name];
            return reg === undefined ? name : `${name}: ${envSummary(reg)}`;
        })
        .join('; ');
    throw new Error(`No image provider is configured. Credentials wanted — ${wanted}`);
}

/**
 * D6 runtime fallback (task 0165) — the envelope's `fallback` field as the schema admits it:
 * absent (strict), `true` (AUTO_ORDER), or an explicit ordered list. Shape-only; name validation
 * happens in {@link resolveFallbackOrder}, because `job.ts` must not import this registry.
 */
export type FallbackSpec = true | readonly string[] | undefined;

/** The ordered candidate list the retry loop (task 0166) walks, plus every dropped candidate. */
export interface FallbackOrder {
    /** Invariant: non-empty, no duplicates, `order[0] === requested`. */
    order: string[];
    /** Candidates dropped because `skipReason` returned a string; never contains `requested`. */
    skipped: { provider: string; reason: string }[];
}

/**
 * Turn the envelope's `fallback` field into the candidate order for the retry loop (task 0166).
 * Pure: availability and reference support arrive through `skipReason`, which 0166 builds from
 * provider instances — nothing here constructs or calls a provider. Behaviour:
 *
 * - absent → `[requested]` (strict, today's fail-fast).
 * - `true` → `requested`, then AUTO_ORDER minus NEVER_AUTO minus `requested`, in AUTO_ORDER order.
 * - list → `requested`, then the list in the given order, deduped and minus `requested`.
 *
 * An unknown name in a list throws before any provider call, because a typo must fail loud, not
 * silently shrink the chain. An explicitly listed NEVER_AUTO provider is allowed: NEVER_AUTO
 * governs automatic choice only (mirrors selectProvider's explicit pin rule). `skipReason` is
 * consulted for candidates only — never `requested`, so `order` always keeps the already-selected
 * provider first.
 */
export function resolveFallbackOrder(
    requested: string,
    fallback: FallbackSpec,
    options?: { skipReason?: (name: string) => string | undefined },
): FallbackOrder {
    if (fallback === undefined) {
        return { order: [requested], skipped: [] };
    }

    let candidates: readonly string[];
    if (fallback === true) {
        candidates = AUTO_ORDER.filter((name) => !NEVER_AUTO.has(name) && name !== requested);
    } else {
        const names = Object.keys(PROVIDERS).sort();
        const seen = new Set<string>([requested]);
        const listed: string[] = [];
        for (const name of fallback) {
            if (PROVIDERS[name] === undefined) {
                throw new Error(`Unknown fallback provider '${name}'. Valid providers: ${names.join(', ')}`);
            }
            if (!seen.has(name)) {
                seen.add(name);
                listed.push(name);
            }
        }
        candidates = listed;
    }

    const order = [requested];
    const skipped: { provider: string; reason: string }[] = [];
    for (const name of candidates) {
        const reason = options?.skipReason?.(name);
        if (reason === undefined) {
            order.push(name);
        } else {
            skipped.push({ provider: name, reason });
        }
    }
    return { order, skipped };
}
