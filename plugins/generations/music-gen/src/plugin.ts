import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { echo, echoError } from '@gobing-ai/ts-utils';
import { createMusicInstance } from './adapter';
import type { AnalysisOutcome, MusicInstance } from './adapter/instance';
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
import { parseMusicJob } from './job';
import { type MusicGenerateRequest, renderGenerateRequest } from './request';
import {
    estimateAnalyze,
    estimateGenerate,
    formatEstimate,
    planGeneration,
    resolveTakeCount,
    type SpendEmit,
    type SpendEstimate,
    SpendRefusal,
    type SpendRequest,
    withConfirmation,
} from './spend';

/**
 * The generator entry (task 0398 R1/R5/R6): read the brief, run the takes, map
 * the result onto the generator contract.
 *
 * Take loop (Design "Takes are a client loop"): `takes: N` issues N sequential
 * single take requests, and each persists or fails independently. A failure on
 * take k leaves takes 1..k-1 on disk, so the failure path deletes `--out` only,
 * never an already-paid artifact.
 *
 * **Order of operations (task 0400 R1–R3).** The spend guard runs before the
 * adapter is built: cap → estimate → confirmation → run-scoped dedupe. So a
 * refused or unconfirmed run prints its estimate and stops, and no socket is
 * opened. A resumed run that re-requests an already-paid take is refused by
 * dedupe unless the operator asks for the re-roll explicitly with
 * `--force --reason <text>`; the refusal names the existing artifact path.
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
    /** Where the pre-spend estimate is printed; defaults to stdout. */
    emit?: SpendEmit;
    /** The 0400 spend request: `--yes`, `--force --reason <text>`, `--takes <n>`. */
    spend?: SpendRequest;
}

/** Read and validate the `--in` DocList; one reader for the generate and estimate paths. */
async function readMusicDocs(fileSystem: FileSystem, inputPath: string): Promise<Doc[]> {
    let docs: Doc[];
    try {
        const raw = await fileSystem.readFile(inputPath);
        docs = DocListSchema.parse(JSON.parse(raw));
    } catch (err: unknown) {
        throw new Error(`Invalid DocList input: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (docs.length === 0) {
        throw new Error('Invalid music job input: the DocList is empty — docs[0].body must carry the YAML brief');
    }
    return docs;
}

/** Default estimate channel: stdout, so a human sees the cost before the money leaves. */
function echoEstimate(block: string): void {
    echo(block);
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
    const emit = options.emit ?? echoEstimate;
    const spend = options.spend ?? {};

    // Start clean for the contract file only: persisted takes stay (see the module header).
    await fs.deleteFile(outputPath);

    const docs = await readMusicDocs(fs, inputPath);

    const { brief, spec, job } = parseMusicJob(docs);
    const config = options.config ?? (await resolveMusicConfig({ fileSystem: fs }));
    const outDir = dirname(outputPath);
    const slug = takeSlug(spec.outputStem ?? job.title);

    // Reference images: hash the bytes for the digest (0397 §7) and encode them for
    // the wire. Both happen once per job — the images are identical across takes.
    const imageBytes = job.images.length === 0 ? [] : await Promise.all(job.images.map((path) => readImage(path)));
    const imageHashes = imageBytes.map((bytes) => sha256Hex(bytes));
    const imageDataUrls = imageBytes.map((bytes, index) => imageDataUrl(job.images[index] ?? '', bytes));

    await fs.ensureDir(outDir);

    // The 0400 guard: cap, estimate, confirmation, run-scoped dedupe — all before the
    // adapter exists, so a refusal can never be preceded by a socket. `--force`/`--reason`
    // may ride either the argv (0401) or `metadata.musicGen` (0398's authoring form).
    const force = spend.force ?? spec.force === true;
    const reason = spend.reason ?? spec.reason;
    const plan = await planGeneration({
        job,
        prices: config.prices,
        takesCap: config.takesCap,
        ...(spend.takes === undefined ? {} : { requestedTakes: spend.takes }),
        ...(spend.confirmed === undefined ? {} : { confirmed: spend.confirmed }),
        force,
        ...(reason === undefined ? {} : { reason }),
        runDir: outDir,
        imageHashes,
        emit,
        fileSystem: fs,
    });

    const client = options.client ?? createMusicInstance(config);

    const liner: LinerTake[] = [];
    const records: ContentTakeRecord[] = [];
    let lastError: unknown;
    for (const [takeIndex, digest] of plan.digests.entries()) {
        try {
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
                unitPrice: plan.estimate.unitPrice,
                adoptedByReconciliation: generated.adoptedByReconciliation,
                unclaimed: generated.unclaimed,
                forced: plan.forced,
                ...(plan.reason === null ? {} : { reason: plan.reason }),
                ...(config.runId === undefined ? {} : { runId: config.runId }),
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
    if (records.length < plan.takes) {
        // A later take failed: what was paid for stays on disk, and the contract file is not written.
        throw new Error(
            `music-gen: take ${String(records.length + 1)} of ${String(plan.takes)} failed after ${String(records.length)} take(s) were persisted in ${outDir}: ${
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
 * Options for the estimate-only path.
 *
 * There is deliberately no adapter and no `fetch` seam here: this path cannot
 * open a socket because it has nothing to open one with (0400 R1).
 */
export interface MusicEstimateOptions {
    /** Config override; resolves from env + the kk config file when absent. */
    config?: MusicConfig;
    /** File-system seam override (reading the brief only). */
    fileSystem?: FileSystem;
    /** `--takes` override; still bounded by `music.takesCap` (0400 R4). */
    takes?: number;
}

/**
 * Plan a generate job and return its pre-spend estimate without spending
 * anything (0400 R1: `--estimate-only`).
 *
 * Resolves the brief, the model, the take count and the unit price, and runs no
 * dedupe: an estimate is a preview, so it must not refuse on a run directory
 * the operator has not decided to re-run yet.
 */
export async function estimateMusicJob(inputPath: string, options: MusicEstimateOptions = {}): Promise<SpendEstimate> {
    const fs = options.fileSystem ?? createNodeFileSystem();
    const docs = await readMusicDocs(fs, inputPath);
    const { job } = parseMusicJob(docs);
    const config = options.config ?? (await resolveMusicConfig({ fileSystem: fs }));
    const takes = resolveTakeCount(options.takes ?? job.takes, config.takesCap);
    return estimateGenerate({ job, prices: config.prices, takes });
}

/** Options for {@link analyzeTake}. */
export interface MusicAnalyzeOptions {
    /** Adapter to analyze through; injected so a test opens no socket. */
    client: MusicInstance;
    config: MusicConfig;
    /** `--yes`, or the workflow var the HITL gate sets (0400 R2). */
    confirmed?: boolean;
    /** Where the pre-spend estimate is printed; defaults to stdout. */
    emit?: SpendEmit;
    /** The model recorded on the take, when the caller knows it (display only). */
    model?: string;
}

/**
 * Analyze one take behind the 0400 confirmation gate (R1/R2).
 *
 * `POST /api/ai/analyze` is a paid call like generate, and `music.prices.analyze`
 * has no default, so the estimate usually reads `unpriced` — which still demands
 * confirmation. One entry point, so `kk music analyze` (0401) cannot bypass it.
 */
export async function analyzeTake(instanceId: string, options: MusicAnalyzeOptions): Promise<AnalysisOutcome> {
    const estimate = estimateAnalyze({
        prices: options.config.prices,
        instanceId,
        ...(options.model === undefined ? {} : { model: options.model }),
    });
    (options.emit ?? echoEstimate)(formatEstimate(estimate));
    return await withConfirmation(estimate, options.confirmed, async () => await options.client.analyze(instanceId));
}

/** Parse `--takes`; the guard owns the domain rule, so an unparseable value is a refusal too. */
function parseTakesFlag(raw: string): number {
    if (!/^\d+$/.test(raw.trim())) {
        throw new SpendRefusal(`--takes ${raw} is not a whole number`, {
            flag: '--takes',
            remedy: 'pass --takes with a whole number of takes (1 or more)',
        });
    }
    return Number(raw.trim());
}

/**
 * The plugin entry: `--in <DocList> --out <content.json>` plus the 0400 spend
 * flags `--yes`, `--estimate-only`, `--force`, `--reason`, `--takes`.
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
            yes: { type: 'boolean' },
            'estimate-only': { type: 'boolean' },
            force: { type: 'boolean' },
            reason: { type: 'string' },
            takes: { type: 'string' },
        },
    });
    if (!values.in || !values.out) {
        echoError('music-gen failed: Missing required arguments: --in and --out');
        return 1;
    }
    try {
        if (values['estimate-only'] === true) {
            const takes = values.takes === undefined ? {} : { takes: parseTakesFlag(values.takes) };
            echo(formatEstimate(await estimateMusicJob(values.in, takes)));
            return 0;
        }
        const spend: SpendRequest = {
            ...(values.yes === true ? { confirmed: true } : {}),
            ...(values.force === true ? { force: true } : {}),
            ...(values.reason === undefined ? {} : { reason: values.reason }),
            ...(values.takes === undefined ? {} : { takes: parseTakesFlag(values.takes) }),
        };
        await processGeneratorIO(values.in, resolve(values.out), { spend });
        return 0;
    } catch (err: unknown) {
        echoError(`music-gen failed: ${err instanceof Error ? err.message : String(err)}`);
        return err instanceof SpendRefusal ? err.exitCode : 1;
    }
}
