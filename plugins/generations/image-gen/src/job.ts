import type { Doc } from '@gobing-ai/kk-core';
import { z } from 'zod';
import type { ProviderErrorClass } from './providers/errors';

/**
 * Task 0104 — the frozen `--in` envelope. A plugin's only input channel is the
 * `--in` JSON (the spawn argv is frozen at `--in`/`--out`,
 * `apps/cli/src/invoke.ts:118-123`), so exactly one job spec rides on the
 * first document's `metadata.imageGen`, and the array itself is the content.
 */

/** The three v1 job branches; a resolved format preset's `job` field must match. */
export const IMAGE_JOBS = ['free', 'cover', 'illustration'] as const;
export type ImageJob = (typeof IMAGE_JOBS)[number];

/** Job spec parsed from `docs[0].metadata.imageGen` (frozen 0104 Design). */
export interface ImageJobSpec {
    job: ImageJob;
    /** FormatPreset name (0102); default per job is the job's own preset name. */
    format?: string;
    /** StylePreset name; default = format.defaultStyle. */
    style?: string;
    /** Template variables (0102 composePrompt); caller values win over preset defaults. */
    vars?: Record<string, string>;
    /** Free text appended as composePrompt's 4th segment. */
    extra?: string;
    /** 0103 selectProvider's `requested` name. */
    provider?: string;
    /**
     * D6 runtime fallback (0165). Absent = strict: one provider, fail fast. `true` = on a
     * fallback-eligible error retry down AUTO_ORDER (minus NEVER_AUTO). A list = retry in exactly
     * that order. Name validation lives in resolveFallbackOrder — this file must not import the
     * provider registry (it pulls in every adapter).
     */
    fallback?: true | string[];
    model?: string;
    /** Absolute paths (0105 pass-through). */
    referenceImages?: string[];
    /** Illustration only: images to produce; default 1. */
    count?: number;
    /** Budget cap (R6); wins over KK_IMAGE_MAX_IMAGES. */
    maxImages?: number;
    seed?: number;
    /** Overrides the `--out` basename for artefact names. */
    outputStem?: string;
}

/** Strict on purpose: the envelope is frozen and 0106 writes it — a typo'd key must fail loud, not vanish. */
export const ImageJobSpecSchema = z.strictObject({
    job: z.enum(IMAGE_JOBS),
    format: z.string().optional(),
    style: z.string().optional(),
    vars: z.record(z.string(), z.string()).optional(),
    extra: z.string().optional(),
    provider: z.string().optional(),
    /** Absent = strict; `true` or a non-empty list of non-empty strings. `false`/`[]` fail so "off" has one spelling. */
    fallback: z.union([z.literal(true), z.array(z.string().min(1)).min(1)]).optional(),
    model: z.string().optional(),
    referenceImages: z.array(z.string()).optional(),
    count: z.number().int().positive().optional(),
    maxImages: z.number().int().positive().optional(),
    seed: z.number().int().optional(),
    outputStem: z.string().optional(),
});

/** One generated image inside `Content.metadata.images` (frozen 0104 Design). */
export interface ImageArtifact {
    /** Absolute; always a sibling of `--out`. */
    path: string;
    /** FormatPreset name. */
    format: string;
    /** StylePreset name. */
    style: string;
    provider: string;
    model: string;
    /** The exact prompt string sent. */
    prompt: string;
    seed?: number;
    /**
     * 0182 R3: what the provider was asked for — 'exact' when the request carried the
     * preset's declared width/height (the provider reported it could honour them for this
     * model), 'aspect' for the aspect-only shape. Present on every written artifact.
     */
    sizeRequest?: 'exact' | 'aspect';
    width?: number;
    height?: number;
    bytes: number;
    /**
     * Task 0180 (F616 R5): when the format has a compose block, the raw provider
     * illustration is recorded here. `path` on the parent artifact is the composed
     * card. `xhs-pub` reads only `.path`, so the publish DTO is unchanged.
     */
    illustration?: { path: string; width?: number; height?: number; bytes: number };
}

/** One illustration caption, the wt captions.json payload reduced to what consumers read (R4). */
export interface CaptionEntry {
    index: number;
    path: string;
    caption: string;
    altText: string;
    anchor: string;
}

/**
 * One failed provider try, recorded by the D6 fallback loop (task 0166). The classifier class lives
 * in `./providers/errors` — a leaf module with no imports — so this file stays clear of the
 * provider registry (which pulls in every adapter).
 */
export interface ProviderAttempt {
    /** 1-based image number in the run (same scale as `captions[].index` and the `-NN` artefact suffix). */
    image: number;
    /** The provider whose validate/generate call failed. */
    provider: string;
    /** The model the failed call sent (`spec.model` on the requested provider, else its default). */
    model: string;
    /** The 0164 classification that drove the retry decision. */
    errorClass: ProviderErrorClass;
    /** The failed call's own error message, unwrapped. */
    message: string;
}

/** Typed shape of this plugin's `Content.metadata` (frozen keys, 0104 Design). */
export interface ImageGenMetadata {
    generator: 'kk:image-gen';
    job: ImageJob;
    images: ImageArtifact[];
    /** Illustration/cover: the input doc's id — the original article is never mutated. */
    sourceDocId?: string;
    /** Illustration only: the captions payload. */
    captions?: CaptionEntry[];
    /** D6 fallback (0166): every failed provider try in attempt order; present only when non-empty. */
    attempts?: ProviderAttempt[];
    /** Set only when the run spent nothing (R6 dry run). */
    dryRun?: true;
}

function jobList(): string {
    return IMAGE_JOBS.map((job) => `'${job}'`).join(', ');
}

function zodIssues(error: z.ZodError): string {
    return error.issues.map((issue) => `${issue.path.join('.') || 'spec'}: ${issue.message}`).join('; ');
}

/**
 * Parse the job spec from `docs[0].metadata.imageGen`; fail loud, naming the
 * frozen path and the valid `job` values, before any preset or provider work.
 */
export function parseJobSpec(docs: Doc[]): ImageJobSpec {
    const raw = docs[0]?.metadata?.imageGen;
    if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error(
            `Invalid image job spec at metadata.imageGen: expected an object with a "job" of ${jobList()}, received ${
                raw === undefined ? 'nothing' : JSON.stringify(raw)
            }`,
        );
    }
    const result = ImageJobSpecSchema.safeParse(raw);
    if (!result.success) {
        throw new Error(`Invalid image job spec at metadata.imageGen: ${zodIssues(result.error)}`);
    }
    return result.data;
}

const PositionsSchema = z.array(z.string());

/**
 * Read `docs[0].metadata.positions` — the caller's (0106) chosen insertion
 * anchors for the illustration job. Shape-only here; the anchor-occurs-once
 * check against the body belongs to the illustration branch.
 */
export function readPositions(docs: Doc[]): string[] | undefined {
    const raw = docs[0]?.metadata?.positions;
    if (raw === undefined) {
        return undefined;
    }
    const result = PositionsSchema.safeParse(raw);
    if (!result.success) {
        throw new Error(
            `Invalid docs[0].metadata.positions: expected an array of string anchors: ${zodIssues(result.error)}`,
        );
    }
    return result.data;
}
