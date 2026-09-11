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
    /** Optional exact pixels; providers that only take an aspect ratio ignore them. */
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
    /** Throw on an impossible combination (e.g. Imagen + referenceImages) before spending money. */
    validate?(req: ImageRequest): void;
    generate(req: ImageRequest): Promise<ImageResult>;
}

/** Injection seam for tests — mirrors `VoiceboxClientOptions.fetch` (voice-gen). */
export interface ProviderOptions {
    fetch?: typeof fetch;
    /** Environment consulted instead of process.env (tests). */
    env?: Record<string, string | undefined>;
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
