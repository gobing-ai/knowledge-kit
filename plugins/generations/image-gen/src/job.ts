import type { Doc } from '@gobing-ai/kk-core';
import { z } from 'zod';

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
    width?: number;
    height?: number;
    bytes: number;
}

/** One illustration caption, the wt captions.json payload reduced to what consumers read (R4). */
export interface CaptionEntry {
    index: number;
    path: string;
    caption: string;
    altText: string;
    anchor: string;
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
