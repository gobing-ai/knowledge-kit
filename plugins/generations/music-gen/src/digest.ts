import { createHash } from 'node:crypto';
import type { MusicModel } from './brief';
import type { ResolvedJob } from './presets';
import { renderBriefPrompt } from './render';

/**
 * Digest input (task 0397 Design "Digest input"): the canonical request that
 * 0400 uses as its run-scoped dedupe key and that 0398 records as take
 * provenance.
 *
 * The canonical form is `{model, prompt, lyrics, durationTarget, language,
 * images, takeIndex}` with absent values as `null` (never omitted, so a missing
 * field cannot alias a present one), image *content* hashes in brief order, and
 * `takeIndex` last.
 *
 * `takeIndex` is part of the key on purpose: `takes: N` renders N structurally
 * identical requests, so without it takes 2..N would collide with take 1 and
 * run-scoped dedupe would refuse the run's own takes.
 */

/** The canonical digest input. `null` means "absent", never "empty". */
export interface MusicDigestInput {
    model: MusicModel;
    prompt: string;
    lyrics: string | null;
    durationTarget: string | null;
    language: string;
    /** SHA-256 hex of each reference image, in brief order. */
    images: string[];
    /** 0-based take index within the job. */
    takeIndex: number;
}

/** Options for {@link digestInput}. */
export interface DigestOptions {
    /** SHA-256 hex of each brief image, in brief order; required when the brief carries images. */
    imageHashes?: string[];
    /** 0-based take index; defaults to 0. */
    takeIndex?: number;
}

/** SHA-256 hex helper: the digest module's single hashing primitive. */
function createSha256Hex(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Build the canonical digest input for one take of a resolved job. */
export function digestInput(job: ResolvedJob, options: DigestOptions = {}): MusicDigestInput {
    const takeIndex = options.takeIndex ?? 0;
    if (!Number.isInteger(takeIndex) || takeIndex < 0) {
        throw new Error(`takeIndex must be a non-negative integer (got ${String(takeIndex)})`);
    }
    const imageHashes = options.imageHashes ?? [];
    if (imageHashes.length !== job.images.length) {
        throw new Error(
            `digest needs one content hash per image: ${String(job.images.length)} image(s) in the brief, ${String(imageHashes.length)} hash(es) supplied`,
        );
    }
    return {
        model: job.model.value,
        prompt: renderBriefPrompt(job),
        lyrics: job.lyrics === undefined ? null : job.lyrics,
        durationTarget: job.model.value === 'pro' ? (job.duration_target.value ?? null) : null,
        language: job.language.value,
        images: [...imageHashes],
        takeIndex,
    };
}

/** Canonical JSON: fixed key order, no whitespace, `null` for absent values. */
export function canonicalDigestJson(input: MusicDigestInput): string {
    return JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        lyrics: input.lyrics,
        durationTarget: input.durationTarget,
        language: input.language,
        images: input.images,
        takeIndex: input.takeIndex,
    });
}

/** SHA-256 hex of the canonical JSON — the value 0400 compares against sidecars. */
export function canonicalDigestSha256(input: MusicDigestInput): string {
    return createSha256Hex(canonicalDigestJson(input));
}

/** Digest input, canonical JSON and hash for one take. */
export interface TakeDigest {
    input: MusicDigestInput;
    canonicalJson: string;
    sha256: string;
}

/** Compute the full digest bundle for one take of a resolved job. */
export function takeDigest(job: ResolvedJob, options: DigestOptions = {}): TakeDigest {
    const input = digestInput(job, options);
    const canonicalJson = canonicalDigestJson(input);
    return { input, canonicalJson, sha256: createSha256Hex(canonicalJson) };
}
