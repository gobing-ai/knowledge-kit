/**
 * The seven `kk music` verb bodies (task 0401 R1–R4).
 *
 * Every verb is a **thin delegate**: it loads the brief, hands it to the plugin
 * function that owns the behaviour, and routes the result into one stable
 * payload. No prompt rendering, no spend rule, no ffmpeg argv and no HTTP lives
 * here — those are `plugins/generations/music-gen/src`'s (0397/0398/0399/0400/0405).
 *
 * Free verbs are free by construction: `render`, `presets`, `check` and `master`
 * never call {@link MusicSeams.createClient}, so they cannot open a socket even
 * when the instance is down (R3).
 *
 * File IO goes through the runtime seam (`musicSeams.fileSystem`, rule
 * `no-direct-fs-io`) rather than `node:fs`: the brief read, the sidecar probe,
 * the prompt/`--out` write and the `gen` staging file.
 */
import { dirname, join, resolve } from 'node:path';
import type { Doc } from '@gobing-ai/kk-core';
import {
    type AudioMeasurement,
    analyzeTake,
    type CheckRow,
    checksExitCode,
    DEFAULT_DELIVERY_PROFILE,
    type DeliveryProfile,
    estimateAnalyze,
    estimateMusicJob,
    explainJob,
    formatEstimate,
    type InstanceTake,
    type LoadedMusicPresets,
    loadMusicPresets,
    type MusicAnalysis,
    type MusicBrief,
    type MusicModel,
    masterTake,
    parseMusicBriefYaml,
    presetLayerForFormat,
    presetLayerForTheme,
    processGeneratorIO,
    type ResolvedMusicConfig,
    readImageBytes,
    renderBriefPrompt,
    renderGenerateRequest,
    resolveDeliveryProfile,
    resolveNamedJob,
    runTakeChecks,
    type SpendEstimate,
    sha256Hex,
    TAKE_SIDECAR_SUFFIX,
    type TakeSidecar,
    takeDigest,
    UnknownPresetError,
} from '@gobing-ai/music-gen';
import { consoleOutput } from '../../output';
import { musicSeams } from './runtime';

/** The verb names, as `kk music --help` lists them. */
export type MusicVerb = 'render' | 'presets' | 'gen' | 'library' | 'analyze' | 'check' | 'master';

/** Verbs whose call is billed (`gen`/`analyze`); every other verb is free. */
const PAID_VERBS: ReadonlySet<MusicVerb> = new Set<MusicVerb>(['gen', 'analyze']);

/** The spend a paid verb approved before it ran. */
export interface SpendRecord {
    currency: 'USD';
    takes: number;
    unitPrice: number | null;
    total: number | null;
}

/**
 * The common payload envelope: every key is always present, `null` when the verb
 * has no such value, so a workflow or skill can read one shape across verbs (R4).
 */
export interface MusicPayload {
    verb: MusicVerb;
    paid: boolean;
    dryRun: boolean;
    artifactPath: string | null;
    instanceId: string | null;
    digest: string | null;
    spend: SpendRecord | null;
    measurements: AudioMeasurement | null;
    checks: CheckRow[] | null;
}

/** Build the envelope for one verb. */
function envelope(verb: MusicVerb, dryRun: boolean): MusicPayload {
    return {
        verb,
        paid: PAID_VERBS.has(verb),
        dryRun,
        artifactPath: null,
        instanceId: null,
        digest: null,
        spend: null,
        measurements: null,
        checks: null,
    };
}

/** Flatten a plugin `SpendEstimate` into the envelope's `spend` slot. */
function spendRecord(estimate: SpendEstimate): SpendRecord {
    return {
        currency: 'USD',
        takes: estimate.takes,
        unitPrice: estimate.unitPrice,
        total: estimate.total,
    };
}

/** Read a brief file and parse it against the 0397 schema. */
async function readBrief(path: string): Promise<MusicBrief> {
    return parseMusicBriefYaml(await musicSeams.fileSystem.readFile(path));
}

/** Load the shipped presets, with the optional `--root` override. */
async function loadPresets(root: string | undefined): Promise<LoadedMusicPresets> {
    return await loadMusicPresets(root === undefined ? {} : { root });
}

/**
 * `music.defaultModel` as the lowest *preset* layer: present only when neither the
 * brief nor the named format preset names a model, so it can never override an
 * authored brief or a shipped preset (0401 R2 + 0397 precedence).
 */
function defaultModelLayer(
    brief: MusicBrief,
    presets: LoadedMusicPresets,
    config: ResolvedMusicConfig,
): { name: string; model: MusicModel } | undefined {
    if (brief.model !== undefined || presets.formats.get(brief.format)?.model !== undefined) {
        return undefined;
    }
    return { name: 'music.defaultModel', model: config.defaultModel };
}

/** The preset layers a brief resolves through, as `metadata.musicGen.presets` carries them. */
function presetLayers(brief: MusicBrief, presets: LoadedMusicPresets) {
    const format = presets.formats.get(brief.format);
    const theme = presets.themes.get(brief.theme);
    if (format === undefined) {
        throw new UnknownPresetError('format', brief.format, [...presets.formats.keys()].sort(), []);
    }
    if (theme === undefined) {
        throw new UnknownPresetError('theme', brief.theme, [...presets.themes.keys()].sort(), []);
    }
    return { format: presetLayerForFormat(format), theme: presetLayerForTheme(theme) };
}

/** Resolve a take's model from the flag, else its sidecar. */
function takeModel(flag: string | undefined, sidecar: TakeSidecar | null): MusicModel {
    const chosen = flag ?? sidecar?.model;
    if (chosen === 'pro' || chosen === 'clip') {
        return chosen;
    }
    throw new UnknownPresetError(
        'format',
        String(chosen ?? ''),
        [],
        ['pass --model pro|clip, or point <take> at a take that has a .take.json sidecar'],
    );
}

/**
 * Read `<take>.take.json` when it exists.
 *
 * A missing sidecar is **not** an error: every caller reads `null` as "this take
 * carries no metadata", so the probe stays a predicate and the read happens only
 * after it answers yes.
 */
async function readSidecar(takePath: string): Promise<TakeSidecar | null> {
    const sidecarPath = `${takePath}${TAKE_SIDECAR_SUFFIX}`;
    const fs = musicSeams.fileSystem;
    if (!(await fs.exists(sidecarPath))) {
        return null;
    }
    return JSON.parse(await fs.readFile(sidecarPath)) as TakeSidecar;
}

/** Options every verb accepts. */
export interface VerbOptions {
    json?: boolean;
}

/** The shared, non-verb-specific context. */
export interface VerbContext {
    config: ResolvedMusicConfig;
    json: boolean;
}

/** Emit a payload: JSON on `--json`, human lines otherwise. */
function emitPayload(payload: MusicPayload, json: boolean, human: string[]): void {
    if (json) {
        consoleOutput.write(JSON.stringify(payload, null, 2));
        return;
    }
    for (const line of human) {
        consoleOutput.write(line);
    }
}

/** `render` — resolve the brief through the presets and show the prompt + request. */
export async function runRender(
    options: VerbOptions & { in: string; out?: string; root?: string },
    context: VerbContext,
): Promise<MusicPayload> {
    const brief = await readBrief(resolve(options.in));
    const presets = await loadPresets(options.root);
    const workflow = defaultModelLayer(brief, presets, context.config);
    const job = resolveNamedJob(brief, presets, workflow === undefined ? {} : { workflow });
    const prompt = renderBriefPrompt(job);
    const request = renderGenerateRequest(job);
    const imageHashes = await Promise.all(
        (brief.images ?? []).map(async (path) => sha256Hex(await readImageBytes(path))),
    );
    const digest = takeDigest(job, { imageHashes, takeIndex: 0 });
    const explain = explainJob(job);
    const outPath = options.out === undefined ? null : resolve(options.out);
    if (outPath !== null) {
        await musicSeams.fileSystem.writeFile(outPath, `${prompt}\n`);
    }
    const payload = {
        ...envelope('render', context.config.dryRun),
        brief: resolve(options.in),
        prompt,
        request,
        explain,
    };
    payload.artifactPath = outPath;
    payload.digest = digest.sha256;
    if (!context.json) {
        for (const line of explain) {
            consoleOutput.write(line);
        }
        consoleOutput.write('');
        consoleOutput.write(prompt);
        consoleOutput.write('');
        consoleOutput.write(JSON.stringify(request, null, 2));
        if (outPath !== null) {
            consoleOutput.write(`prompt written to ${outPath}`);
        }
    } else {
        emitPayload(payload, true, []);
    }
    return payload;
}

/** `presets` — the shipped format/theme inventory (free, no instance traffic). */
export async function runPresets(
    options: VerbOptions & { root?: string },
    context: VerbContext,
): Promise<MusicPayload> {
    const presets = await loadPresets(options.root);
    const formats = [...presets.formats.values()].map((preset) => ({
        name: preset.name,
        model: preset.model,
        duration_target: preset.duration_target ?? null,
        lyrics_policy: preset.lyrics_policy,
        status: preset.provenance.status,
    }));
    const themes = [...presets.themes.values()].map((preset) => ({
        name: preset.name,
        status: preset.provenance.status,
    }));
    const payload = { ...envelope('presets', context.config.dryRun), root: presets.root, formats, themes };
    emitPayload(payload, context.json, [
        `preset root: ${presets.root}`,
        ...formats.map(
            (preset) =>
                `  format ${preset.name} (${preset.model}, ${preset.duration_target ?? 'no duration target'}) — ${preset.status}`,
        ),
        ...themes.map((preset) => `  theme  ${preset.name} — ${preset.status}`),
    ]);
    return payload;
}

/** `library` — the instance's own take list (free, read-only GET). */
export async function runLibrary(_options: VerbOptions, context: VerbContext): Promise<MusicPayload> {
    const client = musicSeams.createClient(context.config);
    const takes: InstanceTake[] = await client.listGenerations();
    const payload = { ...envelope('library', context.config.dryRun), takes };
    emitPayload(
        payload,
        context.json,
        takes.length === 0
            ? ['instance library: no takes']
            : takes.map(
                  (take) =>
                      `  ${take.id} ${take.model ?? '?'} ${take.format ?? '?'}${take.generatedAt === undefined ? '' : ` ${take.generatedAt}`}`,
              ),
    );
    return payload;
}

/** `gen` — the paid generate path behind the 0400 guard. */
export async function runGen(
    options: VerbOptions & {
        in: string;
        out: string;
        yes?: boolean;
        estimateOnly?: boolean;
        force?: boolean;
        reason?: string;
        takes?: string;
        stem?: string;
    },
    context: VerbContext,
): Promise<MusicPayload> {
    const fs = musicSeams.fileSystem;
    const inputPath = resolve(options.in);
    const outputPath = resolve(options.out);
    const takes = options.takes === undefined ? undefined : Number(options.takes);
    if (options.takes !== undefined && (!Number.isInteger(takes) || (takes ?? 0) < 1)) {
        throw new Error(`--takes ${options.takes} is not a whole number of takes (1 or more)`);
    }
    const brief = await readBrief(inputPath);
    const presets = await loadPresets(undefined);
    const layers = presetLayers(brief, presets);
    const workflow = defaultModelLayer(brief, presets, context.config);
    // The plugin's `--in` contract is a DocList: the brief rides `docs[0].body`, the preset
    // layers and knobs ride `metadata.musicGen`. Staged beside `--out` and removed once the
    // plugin has read it, so a run directory keeps only real artifacts.
    const docs: Doc[] = [
        {
            id: `music-brief-${String(process.pid)}`,
            body: await fs.readFile(inputPath),
            title: brief.title,
            metadata: {
                musicGen: {
                    presets: { ...layers, ...(workflow === undefined ? {} : { workflow }) },
                    ...(options.stem === undefined ? {} : { outputStem: options.stem }),
                },
            },
        },
    ];
    const stagingPath = `${outputPath}.doclist.json`;
    await fs.writeFile(stagingPath, `${JSON.stringify(docs, null, 2)}\n`);
    const payload = { ...envelope('gen', context.config.dryRun), contentPath: outputPath, takes: [] as unknown[] };
    try {
        const estimate = await estimateMusicJob(stagingPath, {
            config: context.config,
            ...(takes === undefined ? {} : { takes }),
        });
        if (!context.json) {
            consoleOutput.write(formatEstimate(estimate));
        }
        payload.spend = spendRecord(estimate);
        if (options.estimateOnly === true) {
            emitPayload(payload, context.json, []);
            return payload;
        }
        const content = await processGeneratorIO(stagingPath, outputPath, {
            config: context.config,
            client: musicSeams.createClient(context.config),
            emit: () => {},
            spend: {
                ...(options.yes === true ? { confirmed: true } : {}),
                ...(options.force === true ? { force: true } : {}),
                ...(options.reason === undefined ? {} : { reason: options.reason }),
                ...(takes === undefined ? {} : { takes }),
            },
        });
        const records = (content.metadata?.takes ?? []) as Array<{
            artifactPath: string;
            instanceId: string;
            digest: string;
            unitPrice: number | null;
            model: string;
        }>;
        payload.takes = records;
        payload.artifactPath = outputPath;
        if (records.length === 1) {
            payload.instanceId = records[0]?.instanceId ?? null;
            payload.digest = records[0]?.digest ?? null;
        }
        if (context.json) {
            emitPayload(payload, true, []);
            return payload;
        }
        for (const [index, record] of records.entries()) {
            consoleOutput.write(
                `take ${String(index + 1)}: ${record.artifactPath} (instance ${record.instanceId}, digest ${record.digest})`,
            );
        }
        consoleOutput.write(`content: ${outputPath}`);
        return payload;
    } finally {
        // Unconditional: the seam's delete is force/recursive, so a run that failed
        // before writing the staging file still cleans up without erroring.
        await fs.deleteFile(stagingPath);
    }
}

/** `analyze` — the paid analyze path behind the same 0400 guard. */
export async function runAnalyze(
    instanceId: string,
    options: VerbOptions & { yes?: boolean; model?: string },
    context: VerbContext,
): Promise<MusicPayload> {
    const model = options.model;
    const estimate = estimateAnalyze({
        prices: context.config.prices,
        instanceId,
        ...(model === undefined ? {} : { model }),
    });
    if (!context.json) {
        consoleOutput.write(formatEstimate(estimate));
    }
    const client = musicSeams.createClient(context.config);
    const outcome = await analyzeTake(instanceId, {
        client,
        config: context.config,
        emit: () => {},
        ...(options.yes === true ? { confirmed: true } : {}),
        ...(model === undefined ? {} : { model }),
    });
    const analysis: MusicAnalysis | null = outcome.analysis;
    const payload = {
        ...envelope('analyze', context.config.dryRun),
        cached: outcome.cached,
        charged: outcome.paid,
        analysis,
    };
    payload.instanceId = instanceId;
    payload.spend = spendRecord(estimate);
    emitPayload(payload, context.json, [
        `instance ${instanceId}: analysis ${outcome.cached ? 'cached on the instance' : 'charged this run'}`,
        analysis === null ? '(no analysis object)' : JSON.stringify(analysis, null, 2),
    ]);
    return payload;
}

/**
 * The analysis object of an `analysis-<instanceId>.json` file (task 0403).
 *
 * The documented writer redirects a whole `kk music analyze --json` payload into that file, while a
 * dry run writes the bare offline object — both mean "this take's analysis", so the reader unwraps
 * the envelope instead of forcing every caller to know which shape it has.
 */
export function analysisObject(raw: string): Record<string, unknown> {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const nested = parsed.analysis;
    return typeof nested === 'object' && nested !== null ? (nested as Record<string, unknown>) : parsed;
}

/**
 * `check` — measure a take and write `<take>.checks.json` (free, ffmpeg only).
 *
 * `--brief` fills the three values the brief owns (style prose, structure length, duration target)
 * so the warn-only agreement rows stay measurable through a single verb, and the analysis is read
 * from `--analysis` or, by default, from `analysis-<instanceId>.json` beside the take — the run
 * directory contract's own location (0402). A take with no analysis keeps a `fail` on
 * `analysis.present`: an unanalyzed take is not a passed take.
 */
export async function runCheck(
    takePath: string,
    options: VerbOptions & {
        model?: string;
        durationTarget?: string;
        style?: string;
        sections?: string;
        brief?: string;
        analysis?: string;
    },
    context: VerbContext,
): Promise<MusicPayload> {
    const artifactPath = resolve(takePath);
    const sidecar = await readSidecar(artifactPath);
    const brief = options.brief === undefined ? null : await readBrief(resolve(options.brief));
    const model = takeModel(options.model ?? brief?.model, sidecar);
    const durationTarget = options.durationTarget ?? sidecar?.durationTarget ?? brief?.duration_target;
    const style = options.style ?? brief?.style;
    const sections = options.sections ?? (brief?.structure === undefined ? undefined : String(brief.structure.length));
    const analysisPath =
        options.analysis === undefined
            ? sidecar === null
                ? undefined
                : resolve(join(dirname(artifactPath), `analysis-${sidecar.instanceId}.json`))
            : resolve(options.analysis);
    const hasAnalysis = analysisPath !== undefined && (await musicSeams.fileSystem.exists(analysisPath));
    const analysis = hasAnalysis ? analysisObject(await musicSeams.fileSystem.readFile(analysisPath)) : undefined;
    const runner = musicSeams.audioRunner;
    const outcome = await runTakeChecks({
        artifactPath,
        model,
        ...(durationTarget === undefined ? {} : { durationTarget }),
        ...(style === undefined ? {} : { briefStyle: style }),
        ...(sections === undefined ? {} : { briefSectionCount: Number(sections) }),
        ...(analysis === undefined ? {} : { analysis }),
        ...(runner === undefined ? {} : { runner }),
    });
    const payload = { ...envelope('check', context.config.dryRun), ok: outcome.ok, checksPath: outcome.checksPath };
    payload.artifactPath = artifactPath;
    payload.instanceId = sidecar?.instanceId ?? null;
    payload.digest = sidecar?.digest ?? null;
    payload.measurements = outcome.measurement ?? null;
    payload.checks = outcome.rows;
    emitPayload(payload, context.json, [
        ...outcome.rows.map(
            (row) =>
                `  ${row.result.toUpperCase()} ${row.id}: ${String(row.measured)} ${row.unit} (threshold ${String(row.threshold)})`,
        ),
        `checks written to ${outcome.checksPath}`,
    ]);
    return payload;
}

/** `master` — normalize a take to a delivery profile; the delivery check is the last word. */
export async function runMaster(
    takePath: string,
    options: VerbOptions & { profile?: string; out?: string },
    context: VerbContext,
): Promise<MusicPayload> {
    const take = resolve(takePath);
    const profileName = options.profile ?? DEFAULT_DELIVERY_PROFILE;
    const profile: DeliveryProfile = resolveDeliveryProfile(profileName, context.config.delivery);
    const runner = musicSeams.audioRunner;
    const result = await masterTake({
        takePath: take,
        profileName,
        profile,
        ...(options.out === undefined ? {} : { outputPath: resolve(options.out) }),
        ...(runner === undefined ? {} : { runner }),
    });
    const sidecar = await readSidecar(take);
    const payload = {
        ...envelope('master', context.config.dryRun),
        profile: { name: profileName, ...profile },
        checksPath: result.checksPath,
    };
    payload.artifactPath = result.outputPath;
    payload.instanceId = sidecar?.instanceId ?? null;
    payload.digest = sidecar?.digest ?? null;
    payload.measurements = result.deliveryMeasurement;
    payload.checks = result.delivery;
    emitPayload(payload, context.json, [
        ...result.delivery.map(
            (row) =>
                `  ${row.result.toUpperCase()} ${row.id}: ${String(row.measured)} ${row.unit} (threshold ${String(row.threshold)})`,
        ),
        `mastered ${take} → ${result.outputPath} (${profileName})`,
    ]);
    return payload;
}

/** Exit code a completed `check` carries (1 exactly when a row failed). */
export function checkExitCode(payload: MusicPayload): number {
    return checksExitCode(payload.checks ?? []);
}
