import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Doc } from '@gobing-ai/kk-core';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { type ProviderResolver, processGeneratorIO } from '../src/index';
import type { ImageProvider, ImageRequest } from '../src/providers/types';

let TMP = '';
let OUT = '';
let IN = '';
let stderr = createBufferTarget();
let restoreStderr: (() => void) | undefined;

const ENV_KEYS = [
    'HOME',
    'KNOWLEDGE_KIT_PROJECT_ROOT',
    'KK_IMAGE_PRESET_PATH',
    'KK_IMAGE_DRY_RUN',
    'KK_IMAGE_MAX_IMAGES',
    'IMAGE_GEN_PROVIDER',
] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
    TMP = mkdtempSync(join(tmpdir(), 'kk-image-gen-retry-'));
    OUT = join(TMP, 'out', 'content.json');
    IN = join(TMP, 'in.json');
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    // Presets see only the shipped built-ins; the dry-run/cap seams start unset.
    process.env.HOME = TMP;
    process.env.KNOWLEDGE_KIT_PROJECT_ROOT = join(TMP, 'absent-project');
    process.env.KK_IMAGE_PRESET_PATH = '';
    delete process.env.KK_IMAGE_DRY_RUN;
    delete process.env.KK_IMAGE_MAX_IMAGES;
    delete process.env.IMAGE_GEN_PROVIDER;
    stderr = createBufferTarget();
    restoreStderr = setDefaultOutputTargets({ stderr });
});

afterEach(() => {
    restoreStderr?.();
    restoreStderr = undefined;
    rmSync(TMP, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

/**
 * Real adapter throw strings (0164 fixtures, same as fallback.test.ts) so wording drift in an
 * adapter shows up as a test: `MiniMax API error (NNN): <body>` is minimax.ts's live shape,
 * `HuggingFace HTTP 503: …` huggingface.ts's. These pin the retried classes (transient, quota)
 * against the never-retried ones (auth, policy).
 */
const TRANSIENT = 'MiniMax API error (500): upstream boom';
const RATE_LIMIT = 'MiniMax API error (429): too many requests';
const LOADING = 'HuggingFace HTTP 503: model loading';
const AUTH = 'MiniMax API error (401): invalid api key';
const POLICY =
    'MiniMax API error (400): {"base_resp":{"status_code":2013,"status_msg":"content policy violation: prompt blocked"}}';

interface StubOptions {
    /** Thrown as-is from a generate call — an `Error` carries the fixture message, anything else pins identity. */
    throws?: unknown;
    /** With `throws`: the 1-based generate call that fails; earlier calls succeed; without it every call fails. */
    failOnCall?: number;
    /** Overrides defaultModel() (default `${name}-default-model`). */
    model?: string;
}

interface Stub {
    readonly provider: ImageProvider;
    readonly requests: ImageRequest[];
}

function stub(name: string, options: StubOptions = {}): Stub {
    const requests: ImageRequest[] = [];
    const model = options.model ?? `${name}-default-model`;
    const provider: ImageProvider = {
        name,
        defaultModel: () => model,
        isAvailable: () => true,
        supportsReferenceImages: () => true,
        generate: (request: ImageRequest) => {
            requests.push(request);
            if (
                options.throws !== undefined &&
                (options.failOnCall === undefined || requests.length === options.failOnCall)
            ) {
                return Promise.reject(options.throws);
            }
            return Promise.resolve({
                bytes: new Uint8Array([1, 2, 3]),
                extension: 'png',
                provider: name,
                model: request.model,
            });
        },
    };
    return { provider, requests };
}

/**
 * Wire a stub set into processGeneratorIO (primary rides providerResolver, candidates
 * createProvider) with a recording no-op `sleep` (0269): tests observe the requested backoff ms
 * without ever waiting.
 */
function optionsWith(
    stubs: Record<string, ImageProvider>,
    primaryName: string,
    sleeps: number[],
): {
    providerResolver: ProviderResolver;
    createProvider: (name: string) => ImageProvider;
    sleep: (ms: number) => Promise<void>;
} {
    const primary = stubs[primaryName];
    if (primary === undefined) {
        throw new Error(`fixture is missing the primary stub '${primaryName}'`);
    }
    return {
        providerResolver: () => primary,
        // Names without an injected stub are unconfigured candidates (never generate).
        createProvider: (name) => stubs[name] ?? stub(name, { available: false }).provider,
        sleep: (ms) => {
            sleeps.push(ms);
            return Promise.resolve();
        },
    };
}

function coverDoc(spec: Record<string, unknown>): Doc {
    return {
        id: 'd1',
        title: 'Demo',
        body: 'a red bicycle',
        format: 'markdown',
        references: [],
        metadata: { imageGen: { job: 'cover', ...spec } },
    } as Doc;
}

function readOut(): { metadata: Record<string, unknown>; body: string } {
    return JSON.parse(readFileSync(OUT, 'utf-8')) as { metadata: Record<string, unknown>; body: string };
}

describe('0269 same-provider transient retry', () => {
    test('AC1 — a transient 5xx is retried on the same provider and the image still ships (req: R1; R2)', async () => {
        const mini = stub('minimax', { model: 'image-01', throws: new Error(TRANSIENT), failOnCall: 1 });
        const sleeps: number[] = [];
        writeFileSync(IN, JSON.stringify([coverDoc({ provider: 'minimax', model: 'image-01' })]));

        await processGeneratorIO(IN, OUT, optionsWith({ minimax: mini.provider }, 'minimax', sleeps));

        expect(mini.requests).toHaveLength(2); // the blipped call plus its same-provider retry
        expect(sleeps).toEqual([1000]); // first backoff step (R2)
        const metadata = readOut().metadata;
        const images = metadata.images as Array<Record<string, unknown>>;
        expect(images).toHaveLength(1);
        expect(images[0]?.provider).toBe('minimax');
        expect(existsSync(images[0]?.path as string)).toBe(true); // the run ships; nothing is cleaned up
        expect(existsSync(OUT)).toBe(true);
        expect(metadata.attempts).toEqual([
            { image: 1, provider: 'minimax', model: 'image-01', errorClass: 'transient', message: TRANSIENT },
        ]);
    });

    test('AC2 — a 429 rate-limit failure gets the same bounded retry (req: R1)', async () => {
        const mini = stub('minimax', { model: 'image-01', throws: new Error(RATE_LIMIT), failOnCall: 1 });
        const sleeps: number[] = [];
        writeFileSync(IN, JSON.stringify([coverDoc({ provider: 'minimax', model: 'image-01' })]));

        await processGeneratorIO(IN, OUT, optionsWith({ minimax: mini.provider }, 'minimax', sleeps));

        expect(mini.requests).toHaveLength(2);
        expect(sleeps).toEqual([1000]);
        const metadata = readOut().metadata;
        const images = metadata.images as Array<Record<string, unknown>>;
        expect(images).toHaveLength(1);
        expect(existsSync(images[0]?.path as string)).toBe(true);
        expect(metadata.attempts).toEqual([
            { image: 1, provider: 'minimax', model: 'image-01', errorClass: 'quota', message: RATE_LIMIT },
        ]);
    });

    test('AC3 — the budget is bounded and the backoff grows (req: R2; R5)', async () => {
        const hf = stub('huggingface', { throws: new Error(LOADING) }); // always fails, classifies transient
        const goog = stub('google');
        const sleeps: number[] = [];
        writeFileSync(IN, JSON.stringify([coverDoc({ provider: 'huggingface', fallback: ['google'] })]));

        await processGeneratorIO(
            IN,
            OUT,
            optionsWith({ huggingface: hf.provider, google: goog.provider }, 'huggingface', sleeps),
        );

        expect(hf.requests).toHaveLength(3); // 1 attempt + the 2-retry budget, then the chain advances
        expect(sleeps).toEqual([1000, 2000]); // the backoff grows (R2)
        expect(goog.requests).toHaveLength(1);
        const metadata = readOut().metadata;
        expect((metadata.images as Array<Record<string, unknown>>)[0]?.provider).toBe('google');
        expect(stderr.text()).toContain(
            `WARN image-gen: huggingface failed (transient): ${LOADING}; falling back to google`,
        );
        // Every failed try, retried ones included, is recorded (R5) — three before the advance.
        expect(metadata.attempts).toEqual([
            {
                image: 1,
                provider: 'huggingface',
                model: 'huggingface-default-model',
                errorClass: 'transient',
                message: LOADING,
            },
            {
                image: 1,
                provider: 'huggingface',
                model: 'huggingface-default-model',
                errorClass: 'transient',
                message: LOADING,
            },
            {
                image: 1,
                provider: 'huggingface',
                model: 'huggingface-default-model',
                errorClass: 'transient',
                message: LOADING,
            },
        ]);
    });

    test('AC4 — auth and policy failures are never retried (req: R1)', async () => {
        const boom = new Error(AUTH);
        const mini = stub('minimax', { model: 'image-01', throws: boom });
        const sleeps: number[] = [];
        writeFileSync(IN, JSON.stringify([coverDoc({ provider: 'minimax', model: 'image-01' })]));

        let caught: unknown;
        try {
            await processGeneratorIO(IN, OUT, optionsWith({ minimax: mini.provider }, 'minimax', sleeps));
        } catch (err: unknown) {
            caught = err;
        }
        expect(caught).toBe(boom); // the original error object, unwrapped, exactly as today
        expect(mini.requests).toHaveLength(1);
        expect(sleeps).toEqual([]); // no backoff wait occurs
        expect(existsSync(OUT)).toBe(false);

        const policy = stub('minimax', { model: 'image-01', throws: new Error(POLICY) });
        const policySleeps: number[] = [];
        await expect(
            processGeneratorIO(IN, OUT, optionsWith({ minimax: policy.provider }, 'minimax', policySleeps)),
        ).rejects.toThrow(POLICY);
        expect(policy.requests).toHaveLength(1);
        expect(policySleeps).toEqual([]);
    });
});
