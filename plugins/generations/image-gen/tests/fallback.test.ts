import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
    TMP = mkdtempSync(join(tmpdir(), 'kk-image-gen-fallback-'));
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
 * Real adapter throw strings (0164 fixtures) so wording drift in an adapter shows up as a test:
 * `MiniMax API error (NNN): <body>` is minimax.ts's live shape. The classifier reads statuses from
 * the `(NNN)` group and policy wording first, so these strings pin the auth/quota/policy routes.
 */
const AUTH = 'MiniMax API error (401): {"base_resp":{"status_code":1004,"status_msg":"invalid api key"}}';
const QUOTA = 'MiniMax API error (429): too many requests';
const POLICY =
    'MiniMax API error (400): {"base_resp":{"status_code":2013,"status_msg":"content policy violation: prompt blocked"}}';

interface StubOptions {
    /** Thrown as-is from a generate call — an `Error` carries the fixture message, anything else pins identity. */
    throws?: unknown;
    /** With `throws`: the 1-based generate call that fails; earlier calls succeed. */
    failOnCall?: number;
    /** isAvailable() (default true); false drives the `not configured` skip. */
    available?: boolean;
    /** supportsReferenceImages() (default true); false drives the reference-image skip. */
    refs?: boolean;
    /** 0182: when true, reports exactSize only for model 'image-01' (the MiniMax image-01 rule). */
    exact?: boolean;
    /** Overrides defaultModel() (default `${name}-default-model`). */
    model?: string;
    /** Runs after the request is recorded, before the outcome — proves the WARN precedes the retry. */
    onCall?: () => void;
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
        isAvailable: () => options.available ?? true,
        supportsReferenceImages: () => options.refs ?? true,
        ...(options.exact === true ? { exactSize: (m: string): boolean => m === 'image-01' } : {}),
        generate: (request: ImageRequest) => {
            requests.push(request);
            options.onCall?.();
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

/** Wire a stub set into processGeneratorIO: the primary rides providerResolver, candidates createProvider. */
function optionsWith(
    stubs: Record<string, ImageProvider>,
    primaryName: string,
): { providerResolver: ProviderResolver; createProvider: (name: string) => ImageProvider } {
    const primary = stubs[primaryName];
    if (primary === undefined) {
        throw new Error(`fixture is missing the primary stub '${primaryName}'`);
    }
    return {
        providerResolver: () => primary,
        // Names without an injected stub are unconfigured candidates (never generate).
        createProvider: (name) => stubs[name] ?? stub(name, { available: false }).provider,
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

describe('D6 runtime fallback (0166)', () => {
    test('AC1 — no fallback field: the original error propagates unwrapped, no second provider is called', async () => {
        const boom = new Error(AUTH);
        const mini = stub('minimax', { model: 'image-01', throws: boom });
        const goog = stub('google');
        writeFileSync(IN, JSON.stringify([coverDoc({ provider: 'minimax', model: 'image-01' })]));

        let caught: unknown;
        try {
            await processGeneratorIO(
                IN,
                OUT,
                optionsWith({ minimax: mini.provider, google: goog.provider }, 'minimax'),
            );
        } catch (err: unknown) {
            caught = err;
        }
        expect(caught).toBe(boom);
        expect(goog.requests).toHaveLength(0);
        // Strict mode is silent — today's byte-identical failure (R1).
        expect(stderr.text()).toBe('');
        expect(existsSync(OUT)).toBe(false);
    });

    test('AC2 — fallback true retries down AUTO_ORDER after a loud WARN, on the candidate’s own model', async () => {
        const mini = stub('minimax', { model: 'image-01', throws: new Error(AUTH) });
        let warnBeforeRetry = false;
        const goog = stub('google', {
            model: 'gemini-test-image',
            onCall: () => {
                warnBeforeRetry = stderr.text().includes('; falling back to google');
            },
        });
        writeFileSync(IN, JSON.stringify([coverDoc({ provider: 'minimax', model: 'image-01', fallback: true })]));

        await processGeneratorIO(IN, OUT, optionsWith({ minimax: mini.provider, google: goog.provider }, 'minimax'));

        expect(warnBeforeRetry).toBe(true);
        expect(stderr.text()).toContain(`WARN image-gen: minimax failed (auth): ${AUTH}; falling back to google`);
        expect(goog.requests).toHaveLength(1);
        // spec.model applies only to the requested provider; the winner sends its own default.
        expect(goog.requests[0]?.model).toBe('gemini-test-image');
        const metadata = readOut().metadata;
        const images = metadata.images as Array<Record<string, unknown>>;
        expect(images[0]?.provider).toBe('google');
        expect(images[0]?.model).toBe('gemini-test-image');
        expect(metadata.attempts).toEqual([
            { image: 1, provider: 'minimax', model: 'image-01', errorClass: 'auth', message: AUTH },
        ]);
    });

    test('R3 — an explicit fallback list is attempted in exactly the listed order', async () => {
        const calls: string[] = [];
        const record = (name: string) => () => calls.push(name);
        const mini = stub('minimax', { model: 'image-01', throws: new Error(AUTH), onCall: record('minimax') });
        const goog = stub('google', { throws: new Error(QUOTA), onCall: record('google') });
        const zai = stub('zai', { model: 'glm-image', onCall: record('zai') });
        writeFileSync(IN, JSON.stringify([coverDoc({ provider: 'minimax', fallback: ['google', 'zai'] })]));

        await processGeneratorIO(
            IN,
            OUT,
            optionsWith({ minimax: mini.provider, google: goog.provider, zai: zai.provider }, 'minimax'),
        );

        expect(calls).toEqual(['minimax', 'google', 'zai']);
        const metadata = readOut().metadata;
        expect((metadata.images as Array<Record<string, unknown>>)[0]?.provider).toBe('zai');
        expect(metadata.attempts).toEqual([
            { image: 1, provider: 'minimax', model: 'image-01', errorClass: 'auth', message: AUTH },
            { image: 1, provider: 'google', model: 'google-default-model', errorClass: 'quota', message: QUOTA },
        ]);
    });

    test('AC3 — a content-policy rejection fails the job and never reaches a second provider', async () => {
        const mini = stub('minimax', { model: 'image-01', throws: new Error(POLICY) });
        const goog = stub('google');
        writeFileSync(IN, JSON.stringify([coverDoc({ provider: 'minimax', fallback: true })]));

        await expect(
            processGeneratorIO(IN, OUT, optionsWith({ minimax: mini.provider, google: goog.provider }, 'minimax')),
        ).rejects.toThrow(`image-gen: minimax rejected the prompt (policy): ${POLICY}; fallback does not apply`);
        expect(mini.requests).toHaveLength(1);
        expect(goog.requests).toHaveLength(0);
        expect(existsSync(OUT)).toBe(false);
    });

    test('AC4 — an exhausted order fails loudly naming every provider and class; --out is removed', async () => {
        mkdirSync(dirname(OUT), { recursive: true }); // the plugin owns this dir on success; pre-seed a stale --out to prove deletion
        writeFileSync(OUT, '{"stale": true}');
        const mini = stub('minimax', { model: 'image-01', throws: new Error(AUTH) });
        const goog = stub('google', { throws: new Error(QUOTA) });
        writeFileSync(IN, JSON.stringify([coverDoc({ provider: 'minimax', fallback: ['google'] })]));

        await expect(
            processGeneratorIO(IN, OUT, optionsWith({ minimax: mini.provider, google: goog.provider }, 'minimax')),
        ).rejects.toThrow(`image-gen: all providers failed for image 1: minimax (auth), google (quota); ${QUOTA}`);
        expect(mini.requests).toHaveLength(1);
        expect(goog.requests).toHaveLength(1);
        expect(existsSync(OUT)).toBe(false);
    });

    test('an unconfigured fallback candidate is WARN-skipped once and never called', async () => {
        const mini = stub('minimax', { model: 'image-01', throws: new Error(AUTH) });
        const goog = stub('google');
        const zai = stub('zai', { available: false });
        writeFileSync(IN, JSON.stringify([coverDoc({ provider: 'minimax', fallback: ['zai', 'google'] })]));

        await processGeneratorIO(
            IN,
            OUT,
            optionsWith({ minimax: mini.provider, google: goog.provider, zai: zai.provider }, 'minimax'),
        );

        expect(stderr.text()).toContain('WARN image-gen: skipping fallback zai (not configured)');
        expect(zai.requests).toHaveLength(0);
        expect((readOut().metadata.images as Array<Record<string, unknown>>)[0]?.provider).toBe('google');
        // A winning run still records the primary's failed attempt (R2) — only empty lists stay absent.
        expect(readOut().metadata.attempts).toEqual([
            { image: 1, provider: 'minimax', model: 'image-01', errorClass: 'auth', message: AUTH },
        ]);
    });

    test('a candidate without reference-image support is skipped when reference images are present', async () => {
        const refPath = join(TMP, 'ref.png');
        writeFileSync(refPath, 'REFDATA');
        const mini = stub('minimax', { model: 'image-01', throws: new Error(AUTH) });
        const goog = stub('google');
        const zai = stub('zai', { refs: false });
        writeFileSync(
            IN,
            JSON.stringify([
                coverDoc({ provider: 'minimax', fallback: ['zai', 'google'], referenceImages: [refPath] }),
            ]),
        );

        await processGeneratorIO(
            IN,
            OUT,
            optionsWith({ minimax: mini.provider, google: goog.provider, zai: zai.provider }, 'minimax'),
        );

        expect(stderr.text()).toContain('WARN image-gen: skipping fallback zai (no reference-image support)');
        expect(zai.requests).toHaveLength(0);
        expect(goog.requests[0]?.referenceImages).toEqual([refPath]);
    });

    test('a failed image advances stickily: earlier artefacts are kept, the next image lands on the fallback', async () => {
        const mini = stub('minimax', { model: 'image-01', throws: new Error(AUTH), failOnCall: 2 });
        const goog = stub('google', { model: 'gemini-test-image' });
        const doc = {
            ...coverDoc({ job: 'illustration', provider: 'minimax', fallback: ['google'] }),
            body: 'first alpha second beta end',
            metadata: {
                imageGen: { job: 'illustration', provider: 'minimax', fallback: ['google'] },
                positions: ['alpha', 'beta'],
            },
        } as Doc;
        writeFileSync(IN, JSON.stringify([doc]));

        await processGeneratorIO(IN, OUT, optionsWith({ minimax: mini.provider, google: goog.provider }, 'minimax'));

        const metadata = readOut().metadata;
        const images = metadata.images as Array<Record<string, unknown>>;
        expect(images).toHaveLength(2);
        expect(images[0]?.provider).toBe('minimax');
        expect(images[1]?.provider).toBe('google');
        // Image 1 stayed on the primary; only image 2's failure is recorded.
        expect(metadata.attempts).toEqual([
            { image: 2, provider: 'minimax', model: 'image-01', errorClass: 'auth', message: AUTH },
        ]);
        expect(goog.requests[0]?.prompt).toContain('beta');
        expect(readdirSync(join(TMP, 'out')).filter((name) => name.endsWith('.png'))).toHaveLength(2);
    });

    test('a dry run resolves the order too: an unknown fallback name throws with no provider call', async () => {
        process.env.KK_IMAGE_DRY_RUN = '1';
        const mini = stub('minimax');
        const goog = stub('google');
        writeFileSync(IN, JSON.stringify([coverDoc({ provider: 'minimax', fallback: ['nope'] })]));

        await expect(
            processGeneratorIO(IN, OUT, optionsWith({ minimax: mini.provider, google: goog.provider }, 'minimax')),
        ).rejects.toThrow("Unknown fallback provider 'nope'");
        expect(mini.requests).toHaveLength(0);
        expect(goog.requests).toHaveLength(0);
        expect(existsSync(OUT)).toBe(false);
    });

    test('0182 — the exact gate is per candidate: the primary asks exact, the aspect-only fallback does not (R1/R2)', async () => {
        const mini = stub('minimax', { model: 'image-01', exact: true, throws: new Error(AUTH) });
        const goog = stub('google');
        writeFileSync(IN, JSON.stringify([coverDoc({ provider: 'minimax', model: 'image-01', fallback: ['google'] })]));

        await processGeneratorIO(IN, OUT, optionsWith({ minimax: mini.provider, google: goog.provider }, 'minimax'));

        // The primary was asked for the declared cover canvas with aspectRatio omitted (R1).
        expect(mini.requests[0]?.width).toBe(1344);
        expect(mini.requests[0]?.height).toBe(576);
        expect(mini.requests[0]?.aspectRatio).toBeUndefined();
        // The candidate cannot honour it: aspect-only, on its own default model (R2, D6 invariant).
        expect(goog.requests[0]?.model).toBe('google-default-model');
        expect(goog.requests[0]?.aspectRatio).toBe('21:9');
        expect(goog.requests[0]?.width).toBeUndefined();
        expect(goog.requests[0]?.height).toBeUndefined();
        const images = readOut().metadata.images as Array<Record<string, unknown>>;
        expect(images[0]?.provider).toBe('google');
        expect(images[0]?.sizeRequest).toBe('aspect');
    });
});
