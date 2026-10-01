import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { imageDimensions, readBytes, writeBytes } from './bytes';
import type { CardComposer } from './compose/card';
import { assertCoverage, assertTextFreePrompt, type TextFreeSource } from './compose/card';
import { glyphCoverage } from './compose/cmap';
import {
    type CaptionEntry,
    type ImageArtifact,
    type ImageGenMetadata,
    type ImageJobSpec,
    type ProviderAttempt,
    parseJobSpec,
    readPositions,
} from './job';
import { artifactPath, outStemFor } from './paths';
import { composePrompt, type FormatPreset, loadPresets, type StylePreset } from './presets';
import {
    classifyProviderError,
    type ImageProvider,
    type ImageRequest,
    type ImageResult,
    isFallbackEligible,
    PROVIDERS,
    resolveFallbackOrder,
    selectProvider,
} from './providers/types';

export type { CardComposer, CardInput } from './compose/card';
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

/** Build a fallback candidate from the registry; guards registry drift like defaultProviderResolver. */
function registeredProvider(name: string): ImageProvider {
    const registration = PROVIDERS[name];
    if (registration === undefined) {
        // resolveFallbackOrder rejects unknown names before this runs; this guards drift only.
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
    const parsed = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
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

/** Task 0169: validate the illustration anchor plan against the original body before any provider work. */
function assertAnchorPlan(body: string, positions: string[] | undefined, count: number): void {
    const ranges: { anchor: string; start: number; end: number }[] = [];
    for (let index = 0; index < count; index++) {
        const anchor = positions?.[index];
        if (anchor === undefined) {
            throw new Error('Illustration anchor missing from metadata.positions');
        }
        const found = anchor === '' ? 0 : body.split(anchor).length - 1;
        if (found !== 1) {
            throw new Error(
                `Illustration anchor must occur exactly once in the source body, found ${found}: '${anchor.slice(0, 50)}'`,
            );
        }
        const start = body.indexOf(anchor);
        ranges.push({ anchor, start, end: start + anchor.length });
    }
    // ponytail: O(n²) pair scan; n ≤ maxImages (default 4), so sorting is not worth it.
    for (const [i, a] of ranges.entries()) {
        for (const b of ranges.slice(i + 1)) {
            if (a.start < b.end && b.start < a.end) {
                throw new Error(
                    `Illustration anchors overlap in the source body: '${a.anchor.slice(0, 50)}' and '${b.anchor.slice(0, 50)}'`,
                );
            }
        }
    }
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
    options: {
        providerResolver?: ProviderResolver;
        /** D6 0166: builds fallback candidates by name (tests inject stubs); defaults to the registry. */
        createProvider?: (name: string) => ImageProvider;
        /**
         * Task 0180: injectable card composer. Tests supply a stub; the default is the Chromium
         * composer (same seam style as `providerResolver`). Resolved lazily so missing Playwright
         * surfaces only when a compose-format job is actually requested.
         */
        composer?: CardComposer;
    } = {},
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
        if (spec.job === 'illustration') assertAnchorPlan(doc?.body ?? '', positions, prompts.length);

        // Task 0180 (F616 R4/R5): when the format has a compose block, run pre-spend checks
        // (coverage + a dry compose with no illustration). This runs on BOTH the dry-run and
        // spend branches so a missing-glyph or overflow error never bills the provider.
        let _chromiumComposer: CardComposer | undefined;
        const resolveComposer = async (): Promise<CardComposer> => {
            if (options.composer !== undefined) return options.composer;
            if (_chromiumComposer !== undefined) return _chromiumComposer;
            // Lazy import: Playwright is a runtime dep, not always needed.
            const { makeChromiumComposer } = await import('./compose/chromium');
            _chromiumComposer = makeChromiumComposer();
            return _chromiumComposer;
        };

        if (format.compose !== undefined) {
            const cfg = format.compose;
            if (spec.job !== 'free') {
                throw new Error(
                    `compose: format '${format.name}' has a compose block but the job is '${spec.job}' — compose formats require job: free`,
                );
            }
            const vars = spec.vars ?? {};
            const headline = vars.headline ?? format.variables.headline?.default ?? '';
            if (!headline.trim()) {
                throw new Error(`compose: format '${format.name}' requires a non-empty vars.headline`);
            }
            const pointsRaw = vars.points ?? format.variables.points?.default ?? '';
            const points = pointsRaw.split('\n').filter((l: string) => l.trim() !== '');

            // Task 0181 (F616 R1): the provider prompt must stay text-free — card copy is
            // typeset by the composer. Refusal happens before any font IO, compose, or spend
            // and names the offending segment (template, style preset, extra, or a named var).
            const promptVars: Record<string, string> = { subject: doc?.body ?? '', ...(spec.vars ?? {}) };
            const textFreeSources: TextFreeSource[] = [
                { source: 'the format template', text: format.template },
                {
                    source: `the style preset '${style.name}'`,
                    text: [style.modifiers, style.negative].filter((part) => part !== '').join(', '),
                },
                { source: 'spec.extra', text: spec.extra ?? '' },
                ...Object.entries(promptVars)
                    .filter(([name]) => name !== 'headline' && name !== 'points' && name !== 'index')
                    .map(([name, value]) => ({ source: `vars.${name}`, text: String(value) })),
            ];
            assertTextFreePrompt(prompts[0] ?? '', { headline, points }, textFreeSources);

            // Load font bytes once for coverage check.
            const fontsDir = join(import.meta.dir, '..', 'assets', 'fonts');
            const fontNames = [cfg.fonts.headline, cfg.fonts.body];
            const fontBytesMap = new Map<string, Uint8Array>();
            for (const name of fontNames) {
                fontBytesMap.set(name, new Uint8Array(await readBytes(join(fontsDir, name))));
            }
            const coverageMap = new Map<string, (cp: number) => boolean>();
            for (const [name, bytes] of fontBytesMap) {
                coverageMap.set(name, glyphCoverage(bytes));
            }

            if (format.width == null || format.height == null) {
                throw new Error(
                    `image-gen: format '${format.name}' declares no canvas size; compose requires width and height`,
                );
            }
            const cardInput = {
                headline,
                points,
                role: vars.role ?? format.variables.role?.default ?? 'content',
                compose: cfg,
                width: format.width,
                height: format.height,
            };

            // assertCoverage: fails loud naming field + code point (R4).
            assertCoverage(cardInput, coverageMap);

            // Dry compose (no illustration): proves Chromium is available and layout fits (R5).
            const composer = await resolveComposer();
            await composer.compose(cardInput);
        }

        // Selection must succeed (or fail loud naming the provider) even when nothing is spent.
        const resolveProvider: ProviderResolver = options.providerResolver ?? defaultProviderResolver;
        const primary = resolveProvider(spec);

        // D6 (0166): the fallback order is resolved once, before the dry-run branch, so a typo'd
        // name fails with no spend on both branches. Candidates are created once through the
        // cached `createProvider` seam; `skipReason` consults candidates only, never the primary.
        const built = new Map<string, ImageProvider>();
        const createCandidate = (name: string): ImageProvider => {
            const cached = built.get(name);
            if (cached !== undefined) {
                return cached;
            }
            const created =
                options.createProvider !== undefined ? options.createProvider(name) : registeredProvider(name);
            built.set(name, created);
            return created;
        };
        const skipReason = (name: string): string | undefined => {
            const prospect = createCandidate(name);
            if (!prospect.isAvailable()) {
                return 'not configured';
            }
            if (
                spec.referenceImages !== undefined &&
                spec.referenceImages.length > 0 &&
                !prospect.supportsReferenceImages(prospect.defaultModel())
            ) {
                return 'no reference-image support';
            }
            return undefined;
        };
        const { order, skipped } = resolveFallbackOrder(primary.name, spec.fallback, { skipReason });
        for (const skip of skipped) {
            echoError(`WARN image-gen: skipping fallback ${skip.provider} (${skip.reason})`);
        }

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

        // The money-spending branch: one provider call per prompt, bytes written
        // beside `--out` via artifactPath (R1/R3 worded as 0104 R3), written[]
        // tracking keeps failure cleanup live (dead-loop advisory closed here).
        // D6 (0166): the validate+generate pair rides the fallback loop. `at`
        // advances stickily — an image that fell to candidate i keeps the later
        // images there — and failed attempts never consume the budget cap,
        // which counts produced images only.
        await fs.ensureDir(dirname(outputPath));
        const stem = outStemFor(outputPath, spec.outputStem);
        const artifacts: ImageArtifact[] = [];
        const captions: CaptionEntry[] = [];
        const attempts: ProviderAttempt[] = [];
        let at = 0; // sticky index into `order`
        const generateWithFallback = async (image: number, prompt: string): Promise<ImageResult> => {
            const start = attempts.length; // this image's failed attempts begin here (R5 summarises the slice)
            for (;;) {
                const name = order[at];
                if (name === undefined) {
                    // Unreachable: `at` advances only after order[at + 1] was just proven defined.
                    throw new Error(`image-gen: fallback order exhausted before image ${image} was decided`);
                }
                const provider = at === 0 ? primary : createCandidate(name);
                // spec.model is provider-specific (D6): only the requested provider receives it.
                const model = at === 0 ? (spec.model ?? provider.defaultModel()) : provider.defaultModel();
                const request: ImageRequest = {
                    prompt,
                    model,
                    aspectRatio: format.aspectRatio,
                    ...(spec.referenceImages !== undefined && spec.referenceImages.length > 0
                        ? { referenceImages: spec.referenceImages }
                        : {}),
                };
                try {
                    provider.validate?.(request);
                    return await provider.generate(request);
                } catch (err: unknown) {
                    if (spec.fallback === undefined) {
                        throw err; // D6 R1: strict mode propagates the original error, unwrapped.
                    }
                    const cls = classifyProviderError(err);
                    const message = err instanceof Error ? err.message : String(err);
                    if (!isFallbackEligible(cls)) {
                        // D6 R4: a rejected prompt is never re-asked to a second vendor.
                        throw new Error(
                            `image-gen: ${provider.name} rejected the prompt (policy): ${message}; fallback does not apply`,
                        );
                    }
                    attempts.push({ image, provider: provider.name, model, errorClass: cls, message });
                    const next = order[at + 1];
                    if (next === undefined) {
                        // D6 R5: every candidate failed — name each with its class, then the last message.
                        const detail = attempts
                            .slice(start)
                            .map((attempt) => `${attempt.provider} (${attempt.errorClass})`)
                            .join(', ');
                        throw new Error(`image-gen: all providers failed for image ${image}: ${detail}; ${message}`);
                    }
                    echoError(`WARN image-gen: ${provider.name} failed (${cls}): ${message}; falling back to ${next}`);
                    at += 1;
                }
            }
        };
        let body = doc?.body ?? '';
        for (const [index, prompt] of prompts.entries()) {
            const result = await generateWithFallback(index + 1, prompt);
            // Re-check against the spliced body; the pre-spend plan check is assertAnchorPlan (0169).
            let anchor: string | undefined;
            if (spec.job === 'illustration') {
                anchor = positions?.[index];
                if (anchor === undefined) {
                    throw new Error('Illustration anchor missing from metadata.positions');
                }
                const parts = body.split(anchor);
                if (parts.length !== 2) {
                    throw new Error(
                        `Illustration anchor must occur exactly once in the source body, found ${parts.length - 1}: '${anchor.slice(0, 50)}'`,
                    );
                }
            }

            let artifactPathValue: string;
            let artifactBytes: number;
            let artifactWidth: number | undefined;
            let artifactHeight: number | undefined;
            let illustrationMeta: ImageArtifact['illustration'] | undefined;

            if (format.compose !== undefined) {
                // Task 0180 (F616 R5): compose path.
                // 1. Write the raw provider illustration.
                const illustrationArtifactPath = artifactPath(
                    outputPath,
                    stem,
                    `${format.name}-illustration`,
                    index + 1,
                    result.extension,
                );
                await writeBytes(illustrationArtifactPath, result.bytes);
                written.push(illustrationArtifactPath);

                // 2. Compose the card over the illustration.
                const vars = spec.vars ?? {};
                const headline = vars.headline ?? format.variables.headline?.default ?? '';
                const pointsRaw = vars.points ?? format.variables.points?.default ?? '';
                const points = pointsRaw.split('\n').filter((l: string) => l.trim() !== '');
                if (format.width == null || format.height == null) {
                    throw new Error(
                        `image-gen: format '${format.name}' declares no canvas size; compose requires width and height`,
                    );
                }
                const cardInput = {
                    headline,
                    points,
                    role: vars.role ?? format.variables.role?.default ?? 'content',
                    compose: format.compose,
                    width: format.width,
                    height: format.height,
                    illustration: { bytes: result.bytes, mime: `image/${result.extension}` },
                };
                const composer = await resolveComposer();
                const cardBytes = await composer.compose(cardInput);

                // 3. Write the composed card.
                const cardPath = artifactPath(outputPath, stem, format.name, index + 1, 'png');
                await writeBytes(cardPath, cardBytes);
                written.push(cardPath);

                // 4. Measure the card dimensions via imageDimensions and assert canvas.
                const dims = imageDimensions(cardBytes);
                if (dims.width !== format.width || dims.height !== format.height) {
                    throw new Error(
                        `compose: card dimensions ${dims.width}x${dims.height} do not match format canvas ${format.width}x${format.height}`,
                    );
                }

                artifactPathValue = cardPath;
                artifactBytes = cardBytes.byteLength;
                artifactWidth = dims.width;
                artifactHeight = dims.height;
                illustrationMeta = { path: illustrationArtifactPath, bytes: result.bytes.byteLength };
            } else {
                // Non-compose: existing path (R6).
                const path = artifactPath(outputPath, stem, format.name, index + 1, result.extension);
                await writeBytes(path, result.bytes);
                written.push(path);
                artifactPathValue = path;
                artifactBytes = result.bytes.byteLength;
            }

            const artifact: ImageArtifact = {
                path: artifactPathValue,
                format: format.name,
                style: style.name,
                provider: result.provider,
                model: result.model,
                prompt,
                bytes: artifactBytes,
                ...(artifactWidth !== undefined ? { width: artifactWidth } : {}),
                ...(artifactHeight !== undefined ? { height: artifactHeight } : {}),
                ...(illustrationMeta !== undefined ? { illustration: illustrationMeta } : {}),
            };
            if (spec.seed !== undefined) {
                artifact.seed = spec.seed;
            }
            artifacts.push(artifact);
            if (anchor !== undefined) {
                const parts = body.split(anchor);
                const altText = `Illustration ${index + 1}`;
                const markdown = `${anchor}\n\n![${altText}](${artifactPathValue})`;
                captions.push({
                    index: index + 1,
                    path: artifactPathValue,
                    caption: anchor,
                    altText,
                    anchor,
                });
                // Reinsert the anchor verbatim, then the image — index stays human-reviewable.
                body = `${parts[0]}${markdown}${parts[1]}`;
            }
        }
        const metadata: ImageGenMetadata = {
            generator: 'kk:image-gen',
            job: spec.job,
            images: artifacts,
            ...(spec.job !== 'free' && doc?.id !== undefined ? { sourceDocId: doc.id } : {}),
            ...(captions.length > 0 ? { captions } : {}),
            ...(attempts.length > 0 ? { attempts } : {}),
        };
        const content = ContentSchema.parse({
            // free/cover: the body is the prompt trail (same as dry run); illustration: the
            // source body with round-trip refs inserted (0104 R4 — the input is never mutated).
            body: spec.job === 'illustration' ? body : prompts.join('\n\n---\n\n'),
            title: spec.job === 'illustration' ? (doc?.title ?? format.name) : format.name,
            format: 'image',
            references: [],
            metadata,
        });
        await fs.writeFile(outputPath, JSON.stringify(content, null, 2));
        return;
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
