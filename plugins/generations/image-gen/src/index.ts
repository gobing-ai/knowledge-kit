import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { type ImageGenMetadata, type ImageJobSpec, parseJobSpec, readPositions } from './job';
import { composePrompt, type FormatPreset, loadPresets, type StylePreset } from './presets';
import { type ImageProvider, PROVIDERS, selectProvider } from './providers/types';

export * from './job';
export * from './paths';
export * from './presets';
export * from './providers/types';

const EMPTY_CONTENT: Content = {
    title: 'Notice',
    body: '# Notice\nNo documents provided for generation.',
    format: 'markdown',
    references: [],
};

/** Compiled budget cap (R6). Precedence: spec.maxImages → KK_IMAGE_MAX_IMAGES → this. */
export const DEFAULT_MAX_IMAGES = 4;

/** Resolve the provider instance for a spec; tests inject a stub here — no network. */
export type ProviderResolver = (spec: ImageJobSpec) => ImageProvider;

function defaultProviderResolver(spec: ImageJobSpec): ImageProvider {
    const name = selectProvider(spec.provider);
    const registration = PROVIDERS[name];
    if (registration === undefined) {
        // selectProvider only returns registered names; this guards selector/registry drift.
        throw new Error(`Provider '${name}' was selected but is missing from the registry`);
    }
    return registration.create();
}

/**
 * Budget cap resolution (R6): the spec value wins over the env, which wins over
 * the compiled default — the repo's flag > env > config > default rule, with
 * `maxImages` occupying the flag slot because plugin flags cannot exist (the
 * spawn argv is frozen at `--in`/`--out`, `apps/cli/src/invoke.ts:118-123`).
 */
export function resolveMaxImages(spec: ImageJobSpec): number {
    if (spec.maxImages !== undefined) {
        return spec.maxImages;
    }
    const raw = process.env.KK_IMAGE_MAX_IMAGES;
    if (raw === undefined || raw === '') {
        return DEFAULT_MAX_IMAGES;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`KK_IMAGE_MAX_IMAGES must be a positive integer, received '${raw}'`);
    }
    return parsed;
}

/**
 * Resolve the format/style presets for a spec. Per-job defaults are the three
 * presets 0102 ships, so `{ job: 'cover' }` alone is a complete working job; a
 * format whose `job` field contradicts the requested job is a misconfiguration
 * and fails loud before any spend.
 */
function resolvePresets(spec: ImageJobSpec): { format: FormatPreset; style: StylePreset } {
    const { formats, styles } = loadPresets();
    const formatName = spec.format ?? spec.job;
    const format = formats.get(formatName);
    if (format === undefined) {
        throw new Error(
            `Unknown image format preset '${formatName}'. Valid formats: ${[...formats.keys()].sort().join(', ')}`,
        );
    }
    if (format.job !== spec.job) {
        throw new Error(
            `Format preset '${formatName}' drives the '${format.job}' job, but the spec requests '${spec.job}'`,
        );
    }
    const styleName = spec.style ?? format.defaultStyle;
    const style = styles.get(styleName);
    if (style === undefined) {
        throw new Error(
            `Unknown image style preset '${styleName}'. Valid styles: ${[...styles.keys()].sort().join(', ')}`,
        );
    }
    return { format, style };
}

/**
 * Compose one prompt per image (0102 composePrompt, frozen segment order).
 * - free: the bare prompt rides the format's `subject` slot unless the caller set it;
 * - cover: the caller (0106) supplies vars — the plugin never analyses the article;
 * - illustration: one prompt per caller-chosen anchor, fed as the `concept` var.
 */
function composePrompts(
    spec: ImageJobSpec,
    format: FormatPreset,
    style: StylePreset,
    doc: Doc | undefined,
    positions: string[] | undefined,
): string[] {
    if (spec.job === 'illustration') {
        if (spec.count !== undefined && positions !== undefined && positions.length !== spec.count) {
            throw new Error(
                `Illustration count ${spec.count} does not match the ${positions.length} metadata.positions anchors`,
            );
        }
        const count = positions?.length ?? Math.max(1, spec.count ?? 1);
        return Array.from({ length: count }, (_, index) => {
            const concept = positions?.[index];
            const vars = concept === undefined ? (spec.vars ?? {}) : { concept, ...(spec.vars ?? {}) };
            return composePrompt(format, style, vars, spec.extra);
        });
    }
    // free/cover produce exactly one image (v1 rule, ImageRequest.n default 1).
    const vars = spec.job === 'free' ? { subject: doc?.body ?? '', ...(spec.vars ?? {}) } : (spec.vars ?? {});
    return [composePrompt(format, style, vars, spec.extra)];
}

/**
 * Read validated `Doc[]` input and emit the image-gen `Content` (R1/R3/R6).
 *
 * Prototype scope (task 0104): the envelope, preset resolution, budget cap,
 * provider selection, dry run and failure cleanup are implemented; the three
 * job branches stop at the money-spending boundary — wiring provider bytes to
 * disk needs the no-direct-fs-io binary-write seam plus the 0103+ adapters, so
 * each branch throws `not implemented` after everything before the first
 * provider call has succeeded.
 */
export async function processGeneratorIO(
    inputPath: string,
    outputPath: string,
    options: { providerResolver?: ProviderResolver } = {},
): Promise<void> {
    const fs = createNodeFileSystem();
    // voice-gen rule: start clean, and on any failure delete --out plus every
    // artefact written this run, then rethrow — a failed run leaves nothing.
    await fs.deleteFile(outputPath);
    const written: string[] = [];
    try {
        const raw = await fs.readFile(inputPath);
        let docs: Doc[];
        try {
            docs = DocListSchema.parse(JSON.parse(raw));
        } catch (err: unknown) {
            throw new Error(`Invalid DocList input: ${err instanceof Error ? err.message : String(err)}`);
        }

        if (docs.length === 0) {
            await fs.ensureDir(dirname(outputPath));
            await fs.writeFile(outputPath, JSON.stringify(ContentSchema.parse(EMPTY_CONTENT), null, 2));
            return;
        }

        const spec = parseJobSpec(docs);
        const positions = readPositions(docs);
        const doc = docs[0];

        // Fail before any provider work: invalid spec, presets, or budget.
        const { format, style } = resolvePresets(spec);
        const prompts = composePrompts(spec, format, style, doc, positions);
        const cap = resolveMaxImages(spec);
        if (prompts.length > cap) {
            throw new Error(
                `Image count ${prompts.length} exceeds the budget cap ${cap} (raise ImageJobSpec.maxImages or KK_IMAGE_MAX_IMAGES)`,
            );
        }

        // Selection must succeed (or fail loud naming the provider) even when nothing is spent.
        const resolveProvider: ProviderResolver = options.providerResolver ?? defaultProviderResolver;
        const provider = resolveProvider(spec);

        if (process.env.KK_IMAGE_DRY_RUN === '1') {
            // R6: compose every prompt, select the provider, spend nothing, write no image.
            const metadata: ImageGenMetadata = {
                generator: 'kk:image-gen',
                job: spec.job,
                images: [],
                ...(spec.job !== 'free' && doc?.id !== undefined ? { sourceDocId: doc.id } : {}),
                dryRun: true,
            };
            const content = ContentSchema.parse({
                body: prompts.join('\n\n---\n\n'),
                // Design: free/cover title = the format preset's name; illustration = the source doc's title.
                title: spec.job === 'illustration' ? (doc?.title ?? format.name) : format.name,
                format: 'image',
                references: [],
                metadata,
            });
            await fs.ensureDir(dirname(outputPath));
            await fs.writeFile(outputPath, JSON.stringify(content, null, 2));
            return;
        }

        // The money-spending branches (feature K adapter tickets): each will build
        // its ImageRequests, await provider.generate, write bytes beside --out via
        // artifactPath (R3), and — illustration — insert the round-trip refs (R4).
        throw new Error(
            `image-gen: ${spec.job} job not implemented yet — provider '${provider.name}' selected, ` +
                'image generation lands with the adapter tickets (feature K phase plan)',
        );
    } catch (err: unknown) {
        await fs.deleteFile(outputPath);
        for (const path of written) {
            await fs.deleteFile(path);
        }
        throw err;
    }
}

export async function main(): Promise<number> {
    const { values } = parseArgs({
        options: {
            in: { type: 'string' },
            out: { type: 'string' },
        },
    });

    if (!values.in || !values.out) {
        echoError('image-gen failed: Missing required arguments: --in and --out');
        return 1;
    }

    try {
        await processGeneratorIO(values.in, values.out);
        return 0;
    } catch (err: unknown) {
        echoError(`image-gen failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
