import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { createMusicInstance } from './adapter';
import type { MusicInstance } from './adapter/instance';
import {
    buildTakeSidecar,
    imageDataUrl,
    readImageBytes,
    serializeTakeSidecar,
    sha256Hex,
    takeArtifactName,
    takeSidecarName,
    takeSlug,
    writeAudioBytes,
} from './artifact';
import { type MusicConfig, resolveMusicConfig } from './config';
import { analysisSummary, buildMusicContent, type ContentTakeRecord, type LinerTake } from './content';
import { type TakeDigest, takeDigest } from './digest';
import { parseMusicJob } from './job';
import { type MusicGenerateRequest, renderGenerateRequest } from './request';

/**
 * The generator entry (task 0398 R1/R5/R6): read the brief, run the takes, map
 * the result onto the generator contract.
 *
 * Take loop (Design "Takes are a client loop"): `takes: N` issues N sequential
 * single take requests, and each persists or fails independently. A failure on
 * take k leaves takes 1..k-1 on disk for resume — 0400's run-scoped dedupe skips
 * them — so the failure path deletes `--out` only, never an already-paid
 * artifact.
 */

/** Options a caller (0401's CLI, a test) may inject. */
export interface MusicGeneratorOptions {
    /** Adapter override; tests always pass one so no socket is opened. */
    client?: MusicInstance;
    /** Config override; resolves from env + the kk config file when absent. */
    config?: MusicConfig;
    /** File-system seam override (text IO only — binary audio goes through `artifact.ts`). */
    fileSystem?: FileSystem;
    /** Injected clock, so a test can pin the sidecar's `createdAt`. */
    now?: () => number;
    /** Injected binary reader for reference images. */
    readImage?: (path: string) => Promise<Uint8Array>;
}

/** Read validated `Doc[]` input and emit the music `Content`. */
export async function processGeneratorIO(
    inputPath: string,
    outputPath: string,
    options: MusicGeneratorOptions = {},
): Promise<Content> {
    const fs = options.fileSystem ?? createNodeFileSystem();
    const now = options.now ?? Date.now;
    const readImage = options.readImage ?? readImageBytes;

    // Start clean for the contract file only: persisted takes stay (see the module header).
    await fs.deleteFile(outputPath);

    let docs: Doc[];
    try {
        const raw = await fs.readFile(inputPath);
        docs = DocListSchema.parse(JSON.parse(raw));
    } catch (err: unknown) {
        throw new Error(`Invalid DocList input: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (docs.length === 0) {
        throw new Error('Invalid music job input: the DocList is empty — docs[0].body must carry the YAML brief');
    }

    const { brief, spec, job } = parseMusicJob(docs);
    const config = options.config ?? (await resolveMusicConfig());
    const client = options.client ?? createMusicInstance(config);

    const outDir = dirname(outputPath);
    await fs.ensureDir(outDir);
    const slug = takeSlug(spec.outputStem ?? job.title);

    // Reference images: hash the bytes for the digest (0397 §7) and encode them for
    // the wire. Both happen once per job — the images are identical across takes.
    const imageBytes = job.images.length === 0 ? [] : await Promise.all(job.images.map((path) => readImage(path)));
    const imageHashes = imageBytes.map((bytes) => sha256Hex(bytes));
    const imageDataUrls = imageBytes.map((bytes, index) => imageDataUrl(job.images[index] ?? '', bytes));

    const liner: LinerTake[] = [];
    const records: ContentTakeRecord[] = [];
    let lastError: unknown;
    for (let takeIndex = 0; takeIndex < job.takes; takeIndex += 1) {
        try {
            const digest: TakeDigest = takeDigest(job, { imageHashes, takeIndex });
            const request = withEncodedImages(renderGenerateRequest(job), imageDataUrls);
            const generated = await client.generate(request);
            const artifactName = takeArtifactName(
                slug,
                generated.model === '' ? job.model.value : generated.model,
                generated.id,
                generated.format,
            );
            const artifactPath = join(outDir, artifactName);
            const sidecarPath = join(outDir, takeSidecarName(artifactName));
            await writeAudioBytes(artifactPath, generated.bytes);
            const summary = analysisSummary(generated.analysis);
            const sidecar = buildTakeSidecar({
                digest,
                request,
                instanceId: generated.id,
                model: generated.model === '' ? job.model.value : generated.model,
                format: generated.format,
                takeIndex,
                artifactPath,
                unitPrice: config.prices[job.model.value],
                adoptedByReconciliation: generated.adoptedByReconciliation,
                unclaimed: generated.unclaimed,
                forced: spec.force === true,
                ...(spec.reason === undefined ? {} : { reason: spec.reason }),
                now,
                language: generated.language ?? job.language.value,
                ...(generated.durationTarget === undefined ? {} : { durationTarget: generated.durationTarget }),
                ...(generated.batchCount === undefined ? {} : { batchCount: generated.batchCount }),
                ...(generated.generatedAt === undefined ? {} : { generatedAt: generated.generatedAt }),
                ...(generated.audioUrl === undefined ? {} : { audioUrl: generated.audioUrl }),
                ...(client.provider === 'offline' ? { dryRun: true } : {}),
            });
            await fs.writeFile(sidecarPath, serializeTakeSidecar(sidecar));
            records.push({
                takeIndex,
                instanceId: generated.id,
                model: sidecar.model,
                format: generated.format,
                requestedFormat: request.format,
                digest: digest.sha256,
                digestInput: digest.input,
                artifactPath,
                sidecarPath,
                unitPrice: sidecar.unitPrice,
                adoptedByReconciliation: generated.adoptedByReconciliation,
                unclaimed: generated.unclaimed,
                ...(generated.language === undefined ? {} : { language: generated.language }),
                ...(generated.durationTarget === undefined ? {} : { durationTarget: generated.durationTarget }),
                ...(generated.batchCount === undefined ? {} : { batchCount: generated.batchCount }),
                ...(generated.audioUrl === undefined ? {} : { audioUrl: generated.audioUrl }),
                ...(generated.generatedAt === undefined ? {} : { generatedAt: generated.generatedAt }),
                ...(summary === undefined ? {} : { analysisSummary: summary }),
            });
            liner.push({
                takeIndex,
                instanceId: generated.id,
                model: sidecar.model,
                format: generated.format,
                ...(generated.language === undefined ? {} : { language: generated.language }),
                ...(generated.durationTarget === undefined ? {} : { durationTarget: generated.durationTarget }),
                ...(generated.batchCount === undefined ? {} : { batchCount: generated.batchCount }),
                ...(generated.audioUrl === undefined ? {} : { audioUrl: generated.audioUrl }),
                prompt: request.prompt,
                ...(request.lyrics === undefined ? {} : { lyrics: request.lyrics }),
                ...(summary === undefined ? {} : { analysisSummary: summary }),
                adoptedByReconciliation: generated.adoptedByReconciliation,
                unclaimed: generated.unclaimed,
            });
        } catch (error: unknown) {
            lastError = error;
            break;
        }
    }

    if (records.length === 0) {
        throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'no take was generated'));
    }
    if (records.length < job.takes) {
        // A later take failed: what was paid for stays on disk, and the contract file is not written.
        throw new Error(
            `music-gen: take ${String(records.length + 1)} of ${String(job.takes)} failed after ${String(records.length)} take(s) were persisted in ${outDir}: ${
                lastError instanceof Error ? lastError.message : String(lastError)
            }`,
        );
    }

    const content = ContentSchema.parse(
        buildMusicContent({
            title: brief.title,
            provider: client.provider,
            dryRun: client.provider === 'offline',
            liner,
            takes: records,
        }),
    );
    await fs.writeFile(outputPath, `${JSON.stringify(content, null, 2)}\n`);
    return content;
}

/** Replace the request's image paths with their `data:` encodings (design §4: 0398 encodes for the wire). */
export function withEncodedImages(request: MusicGenerateRequest, dataUrls: readonly string[]): MusicGenerateRequest {
    if (dataUrls.length === 0) {
        return request;
    }
    return { ...request, images: [...dataUrls] };
}

/**
 * The plugin entry: `--in <DocList> --out <content.json>`.
 *
 * @param argv arguments after the script name; defaults to the process argv, and
 *   is a parameter so a test can drive the entry in-process (no spawn).
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
    const { values } = parseArgs({
        args: [...argv],
        options: {
            in: { type: 'string' },
            out: { type: 'string' },
        },
    });
    if (!values.in || !values.out) {
        echoError('music-gen failed: Missing required arguments: --in and --out');
        return 1;
    }
    try {
        await processGeneratorIO(values.in, resolve(values.out));
        return 0;
    } catch (err: unknown) {
        echoError(`music-gen failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}
