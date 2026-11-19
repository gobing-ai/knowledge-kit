import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { UnclaimedTake } from './adapter/instance';
import type { AudioFormat, MusicModel } from './brief';
import type { MusicDigestInput } from './digest';
import type { MusicGenerateRequest } from './request';

/**
 * Artifact naming and persistence (task 0398 R6).
 *
 * **Naming.** `<slug>-<model>-<instanceId>.<ext>`: the slug is the title, the
 * model is the instance's own selector and the id is the instance generation id,
 * so every file is traceable back to the instance library by name alone and two
 * takes of the same brief cannot collide. One sidecar per take:
 * `<artifact>.take.json`.
 *
 * **Boundary.** A take is written into the job's run directory (the `--out`
 * directory) and the instance's `generations/` library is *never* mirrored into a
 * kk workspace: kk records what the workflow needs (digest, instance id, model,
 * unit price, adoption flag) and links the rest.
 *
 * **Why `node:fs` lives here.** The ts-runtime `FileSystem` seam is text-only, so
 * binary audio bytes (and the reference-image bytes the digest hashes) cannot go
 * through it. This file is the plugin's single binary-IO seam, allowlisted in
 * `.spur/rules/strict/runtime-boundaries.yaml` exactly as `image-gen/src/bytes.ts`
 * and `voice-gen/src/index.ts` are.
 */

/** Longest slug the artifact name carries before it is truncated. */
export const MAX_SLUG_LENGTH = 48;

/** Fallback slug when a title has no usable characters. */
export const FALLBACK_SLUG = 'music';

/** Content type of a reference image, by extension. */
const IMAGE_MIME: Readonly<Record<string, string>> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
};

/**
 * Kebab-case a title into a filename-safe slug: ASCII alphanumerics kept,
 * everything else collapsed to single dashes, lowercased, truncated on a word
 * boundary where possible.
 */
export function takeSlug(title: string): string {
    const slug = title
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
    if (slug === '') {
        return FALLBACK_SLUG;
    }
    if (slug.length <= MAX_SLUG_LENGTH) {
        return slug;
    }
    const truncated = slug.slice(0, MAX_SLUG_LENGTH);
    const lastDash = truncated.lastIndexOf('-');
    return lastDash > 0 ? truncated.slice(0, lastDash) : truncated;
}

/**
 * Make an instance generation id safe for a filename. Ids come from the
 * instance, so this is a boundary guard, not a formatter: path separators and
 * `..` must never reach the artifact name.
 */
export function safeInstanceId(instanceId: string): string {
    const cleaned = instanceId
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^[.-]+/, '')
        .replace(/[.-]+$/, '');
    if (cleaned === '' || cleaned.includes('..')) {
        throw new Error(`instance generation id ${JSON.stringify(instanceId)} cannot be used in an artifact name`);
    }
    return cleaned;
}

/** `<slug>-<model>-<instanceId>.<ext>` — the artifact filename for one take. */
export function takeArtifactName(
    slug: string,
    model: MusicModel | string,
    instanceId: string,
    format: AudioFormat,
): string {
    return `${slug}-${model}-${safeInstanceId(instanceId)}.${format}`;
}

/** Suffix that marks a take sidecar; the spend guard's dedupe scan keys off it (task 0400 R3). */
export const TAKE_SIDECAR_SUFFIX = '.take.json';

/** `<artifact>.take.json` — the sidecar filename for one take. */
export function takeSidecarName(artifactFileName: string): string {
    return `${artifactFileName}${TAKE_SIDECAR_SUFFIX}`;
}

/** One take's sidecar. Field ownership is per key so 0400 and 0405 extend it, never replace it. */
export interface TakeSidecar {
    /** SHA-256 of the canonical digest JSON (0397). */
    digest: string;
    /** The canonical digest input (0397) — 0400 compares against it. */
    digestInput: MusicDigestInput;
    instanceId: string;
    model: string;
    /** Delivered container, detected from the bytes (never the requested one). */
    format: AudioFormat;
    /** The exact request body sent to the instance. */
    request: MusicGenerateRequest;
    /** `audio_format` as kk resolved it (the request's `format`). */
    requestedFormat: AudioFormat;
    language: string;
    durationTarget?: string;
    /** Echoed exactly as the instance recorded it; absent when the manifest lacked it. */
    batchCount?: number;
    takeIndex: number;
    /** Unit price charged for this take (`null` when the model is unpriced). */
    unitPrice: number | null;
    adoptedByReconciliation: boolean;
    /** Later library takes that matched the same request: the operator's spend visibility. */
    unclaimed: UnclaimedTake[];
    forced: boolean;
    reason: string | null;
    /** Workflow run this take belongs to, when the caller knows it (0400 R4). */
    runId?: string;
    createdAt: string;
    generatedAt?: string;
    /** Absolute path of the artifact this sidecar describes. */
    artifactPath: string;
    /** The instance audio URL, when the instance served one. */
    audioUrl?: string;
    /** Detectably a dry-run artifact: no instance was called. */
    dryRun?: true;
}

/** Everything {@link buildTakeSidecar} needs. */
export interface TakeSidecarOptions {
    digest: { sha256: string; input: MusicDigestInput };
    request: MusicGenerateRequest;
    instanceId: string;
    model: string;
    format: AudioFormat;
    takeIndex: number;
    artifactPath: string;
    unitPrice: number | null;
    adoptedByReconciliation: boolean;
    unclaimed: UnclaimedTake[];
    forced: boolean;
    reason?: string;
    /** Workflow run id, recorded verbatim when present (0400 R4). */
    runId?: string;
    /** Injected clock so a test can pin `createdAt`. */
    now?: () => number;
    language: string;
    durationTarget?: string;
    batchCount?: number;
    generatedAt?: string;
    audioUrl?: string;
    dryRun?: boolean;
}

/** Build one take sidecar (0397 digest + instance provenance + 0400/0405 slots). */
export function buildTakeSidecar(options: TakeSidecarOptions): TakeSidecar {
    const createdAt = new Date((options.now ?? Date.now)()).toISOString();
    return {
        digest: options.digest.sha256,
        digestInput: options.digest.input,
        instanceId: options.instanceId,
        model: options.model,
        format: options.format,
        request: options.request,
        requestedFormat: options.request.format,
        language: options.language,
        ...(options.durationTarget === undefined ? {} : { durationTarget: options.durationTarget }),
        ...(options.batchCount === undefined ? {} : { batchCount: options.batchCount }),
        takeIndex: options.takeIndex,
        unitPrice: options.unitPrice,
        adoptedByReconciliation: options.adoptedByReconciliation,
        unclaimed: options.unclaimed,
        forced: options.forced,
        reason: options.reason ?? null,
        ...(options.runId === undefined ? {} : { runId: options.runId }),
        createdAt,
        ...(options.generatedAt === undefined ? {} : { generatedAt: options.generatedAt }),
        artifactPath: options.artifactPath,
        ...(options.audioUrl === undefined ? {} : { audioUrl: options.audioUrl }),
        ...(options.dryRun === true ? { dryRun: true } : {}),
    };
}

/** Serialize a sidecar the way every kk artifact is written: 4-space JSON plus one trailing newline. */
export function serializeTakeSidecar(sidecar: TakeSidecar): string {
    return `${JSON.stringify(sidecar, null, 4)}\n`;
}

/**
 * Write audio bytes. Deliberately the only binary writer in the plugin (see the
 * module header): the audio format is chosen by the instance, not by kk.
 */
export async function writeAudioBytes(path: string, bytes: Uint8Array): Promise<void> {
    await writeFile(path, bytes);
}

/** Read reference-image bytes (the digest hashes their content, 0397 §7). */
export async function readImageBytes(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(path));
}

/** SHA-256 hex of a byte buffer. */
export function sha256Hex(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

/** Encode reference-image bytes for the wire (`data:` URL) and keep the mime honest. */
export function imageDataUrl(path: string, bytes: Uint8Array): string {
    const mime = IMAGE_MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
    return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}
