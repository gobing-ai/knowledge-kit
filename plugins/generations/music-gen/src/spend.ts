import { join } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { TAKE_SIDECAR_SUFFIX } from './artifact';
import { MAX_TAKES } from './brief';
import type { MusicPrices } from './config';
import { type TakeDigest, takeDigest } from './digest';
import type { ResolvedJob } from './presets';
import { renderBriefPrompt } from './render';

/**
 * The spend guard (task 0400 R1–R5): the plugin's **one enforcement point for
 * money**.
 *
 * Every paid request this plugin can make — `POST /api/lyria/generate` per take
 * and `POST /api/ai/analyze` — goes through {@link estimateGenerate} /
 * {@link estimateAnalyze} plus {@link requireConfirmation}, and every generate
 * additionally through {@link planGeneration}'s run-scoped dedupe and take cap.
 * `0401` wires the same functions into the `kk music` verbs, and the workflow
 * reaches them only through those verbs, so the skill, the CLI and the workflow
 * cannot each invent their own spend policy.
 *
 * The four rules, in the order {@link planGeneration} applies them:
 *
 * 1. **Estimate first (R1).** `kk prompt text, model, takes, unit price, total`
 *    from `music.prices.{pro,clip,analyze}`. `analyze` has no built-in price, so
 *    it renders as `unpriced` — never "free" — and an unpriced estimate still
 *    demands confirmation.
 * 2. **Confirmation (R2).** No paid call without `--yes` (or the workflow var
 *    the HITL gate sets). The refusal prints the estimate first.
 * 3. **Run-scoped dedupe (R3).** The 0397 per-take digest is compared against the
 *    sidecars already in the run directory. A match refuses and names the
 *    existing artifact path; `--force --reason <text>` overrides and records
 *    both. The lookup location is the scope: the same brief in another topic's
 *    run directory is a legitimate re-roll, so the digest itself stays pure
 *    content and remains a valid cross-run provenance key.
 * 4. **Takes cap (R4).** `music.takesCap`, default {@link DEFAULT_TAKES_CAP},
 *    never above {@link HARD_TAKES_CAP}. Over the cap is a refusal, never a
 *    silent trim.
 *
 * Every refusal is a {@link SpendRefusal} carrying the exact flag that resolves
 * it (R5), and its message contains that flag verbatim, so a caller cannot
 * surface a refusal without the remediation.
 */

/**
 * Takes per invocation when `music.takesCap` is unset (§6.1: "Take cap … `2`,
 * never above `4`"). Two is enough for a judge-two-takes-then-pick workflow and
 * caps the cost of a mistaken re-run at two requests.
 */
export const DEFAULT_TAKES_CAP = 2;

/**
 * Ceiling `music.takesCap` may never exceed — the brief's own `takes` bound
 * (`MAX_TAKES`), so the config cannot authorize a count the brief schema would
 * reject, and one number owns "the hard cap is 4".
 */
export const HARD_TAKES_CAP: number = MAX_TAKES;

/** What a refusal is about: a generate run or a single analyze call. */
export type SpendKind = 'generate' | 'analyze';

/**
 * Raised by every spend refusal (R2/R3/R4/R5).
 *
 * `flag` is the exact thing that resolves it — a CLI flag (`--yes`,
 * `--force --reason <text>`, `--takes`) or the config key `music.takesCap` — and
 * the message always contains it, so "make refusals actionable" is a property of
 * the type rather than of each call site.
 */
export class SpendRefusal extends Error {
    /** Process exit code the command layer must surface. */
    readonly exitCode = 1;
    /** The exact flag (or config key) that resolves this refusal. */
    readonly flag: string;
    /** Machine-readable context: the existing artifact path, the digest, the cap. */
    readonly detail: Readonly<Record<string, string | number | boolean>>;

    constructor(
        reason: string,
        options: {
            flag: string;
            /** Overrides the default `pass <flag>` remediation wording. */
            remedy?: string;
            detail?: Record<string, string | number | boolean>;
        },
    ) {
        super(`music spend guard: ${reason} — ${options.remedy ?? `pass ${options.flag}`}`);
        this.name = 'SpendRefusal';
        this.flag = options.flag;
        this.detail = { ...(options.detail ?? {}) };
    }
}

/** The spend knobs a caller may pass: `--yes`, `--force --reason <text>`, `--takes <n>`. */
export interface SpendRequest {
    /** `--yes`, or the workflow var the HITL gate sets (R2). */
    confirmed?: boolean;
    /** `--force`: override a run-scoped duplicate (R3). Meaningless without `reason`. */
    force?: boolean;
    /** `--reason <text>`: why the paid re-send was accepted; recorded in the sidecar. */
    reason?: string;
    /** `--takes <n>`: take-count override, still bounded by `music.takesCap` (R4). */
    takes?: number;
}

/** Where the rendered estimate goes (`--estimate-only`'s only side effect). */
export type SpendEmit = (block: string) => void;

/** A resolved pre-spend estimate (R1). */
export interface SpendEstimate {
    kind: SpendKind;
    /** The kk prompt text the provider will actually see; `null` for analyze. */
    prompt: string | null;
    /** The resolved model selector (`pro`/`clip`), or the take's recorded model for analyze. */
    model: string | null;
    /** How many paid requests this estimate covers. */
    takes: number;
    /** Per-request price from `music.prices`; `null` = unpriced, never zero. */
    unitPrice: number | null;
    /** `unitPrice × takes`; `null` when unpriced. */
    total: number | null;
    /** True when no price is configured — the confirmation gate still applies. */
    unpriced: boolean;
    /** The instance take an analyze estimate covers. */
    instanceId?: string;
}

/** Input for {@link estimateGenerate}. */
export interface GenerateEstimateInput {
    job: ResolvedJob;
    /** Resolved `music.prices` (defaults already applied by `config.ts`). */
    prices: MusicPrices;
    /** Take count this estimate covers — already validated against the cap. */
    takes: number;
}

/** Input for {@link estimateAnalyze}. */
export interface AnalyzeEstimateInput {
    prices: MusicPrices;
    /** The instance take to analyze. */
    instanceId: string;
    /** The model recorded on the take, when the caller knows it. Display only. */
    model?: string;
}

/** One take's digest, as the dedupe scan needs it. */
export interface TakeDigestEntry {
    takeIndex: number;
    digest: string;
}

/** A take already paid for in this run directory (R3). */
export interface RunDirDuplicate {
    takeIndex: number;
    /** The 0397 per-take digest that matched. */
    digest: string;
    /** Absolute path of the artifact the earlier take wrote — what the refusal shows. */
    artifactPath: string;
    /** Absolute path of the matching sidecar. */
    sidecarPath: string;
}

/** Resolve the effective takes cap from the configured value (R4). */
export function resolveTakesCap(configured: number | undefined): number {
    if (configured === undefined) {
        return DEFAULT_TAKES_CAP;
    }
    if (!Number.isInteger(configured) || configured < 1) {
        throw new SpendRefusal(`music.takesCap is ${String(configured)}, which is not a positive integer`, {
            flag: 'music.takesCap',
            remedy: 'set music.takesCap to a whole number between 1 and 4',
        });
    }
    if (configured > HARD_TAKES_CAP) {
        throw new SpendRefusal(
            `music.takesCap is ${String(configured)}, above the hard cap of ${String(HARD_TAKES_CAP)} takes per invocation`,
            {
                flag: 'music.takesCap',
                remedy: `set music.takesCap to ${String(DEFAULT_TAKES_CAP)}–${String(HARD_TAKES_CAP)} or pass --takes with a count of ${String(HARD_TAKES_CAP)} or less`,
                detail: { cap: configured, hardCap: HARD_TAKES_CAP },
            },
        );
    }
    return configured;
}

/**
 * Resolve the take count for this invocation (R4/R5).
 *
 * Over the cap is a refusal, not a clamp: R5 forbids silently adjusting the take
 * count to fit, and the refusal names both the configured cap and `--takes`.
 */
export function resolveTakeCount(requested: number, configuredCap: number | undefined): number {
    // Re-validated here, not just at config load, so a caller that injects a config
    // object (a test, 0401's JSON path) cannot hand the guard an out-of-domain cap.
    const cap = resolveTakesCap(configuredCap);
    if (!Number.isInteger(requested) || requested < 1) {
        throw new SpendRefusal(`take count ${String(requested)} is not a positive integer`, {
            flag: '--takes',
            remedy: 'pass --takes with a whole number of takes (1 or more)',
        });
    }
    if (requested > cap) {
        throw new SpendRefusal(
            `${String(requested)} takes per invocation exceeds the configured cap of ${String(cap)} (music.takesCap; hard cap ${String(HARD_TAKES_CAP)})`,
            {
                flag: '--takes',
                remedy: `pass --takes ${String(cap)} or fewer, or raise music.takesCap (max ${String(HARD_TAKES_CAP)})`,
                detail: { takes: requested, cap, hardCap: HARD_TAKES_CAP },
            },
        );
    }
    return requested;
}

/** Build the generate estimate from the resolved job and price config (R1). */
export function estimateGenerate(input: GenerateEstimateInput): SpendEstimate {
    const model = input.job.model.value;
    const unitPrice = model === 'pro' ? input.prices.pro : input.prices.clip;
    return {
        kind: 'generate',
        prompt: renderBriefPrompt(input.job),
        model,
        takes: input.takes,
        unitPrice,
        total: unitPrice * input.takes,
        unpriced: false,
    };
}

/** Build the analyze estimate; `music.prices.analyze` has no default, so this is usually unpriced (R1). */
export function estimateAnalyze(input: AnalyzeEstimateInput): SpendEstimate {
    const unitPrice = input.prices.analyze;
    return {
        kind: 'analyze',
        prompt: null,
        model: input.model ?? null,
        takes: 1,
        unitPrice,
        total: unitPrice === null ? null : unitPrice,
        unpriced: unitPrice === null,
        instanceId: input.instanceId,
    };
}

/** `$0.16`, `$0.08`, `$0` — trailing zeros trimmed so 3- and 4-decimal prices stay readable. */
export function formatUsd(value: number): string {
    const trimmed = value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    return `$${trimmed}`;
}

/** `unpriced` for a missing price; the word R1 requires instead of a fake zero. */
function formatPrice(value: number | null): string {
    return value === null ? 'unpriced' : formatUsd(value);
}

/**
 * Render an estimate as the human block `--estimate-only` prints and every paid
 * generate emits before its first request (R1: prompt, model, takes, unit price,
 * total).
 */
export function formatEstimate(estimate: SpendEstimate): string {
    const lines: string[] = [`music spend estimate — ${estimate.kind}`];
    if (estimate.prompt !== null) {
        lines.push('prompt:');
        for (const line of estimate.prompt.split('\n')) {
            lines.push(`  ${line}`);
        }
    }
    if (estimate.instanceId !== undefined) {
        lines.push(`instance: ${estimate.instanceId}`);
    }
    lines.push(`model: ${estimate.model ?? 'unknown'}`);
    lines.push(`takes: ${String(estimate.takes)}`);
    lines.push(`unit price: ${formatPrice(estimate.unitPrice)}`);
    lines.push(`total: ${formatPrice(estimate.total)}`);
    return lines.join('\n');
}

/**
 * R2: refuse a paid call without explicit confirmation.
 *
 * An unpriced estimate is *not* a free one — it demands confirmation exactly
 * like a priced one, and says so.
 */
export function requireConfirmation(estimate: SpendEstimate, confirmed: boolean | undefined): void {
    if (confirmed === true) {
        return;
    }
    const cost = estimate.unpriced
        ? `this ${estimate.kind} is unpriced (set music.prices.${estimate.kind} to see the cost)`
        : `this ${estimate.kind} spends ${formatPrice(estimate.total)} for ${String(estimate.takes)} request${estimate.takes === 1 ? '' : 's'}`;
    throw new SpendRefusal(`${cost}, and no confirmation was given`, {
        flag: '--yes',
        remedy: 'pass --yes to confirm the paid call, or --estimate-only to print the estimate and stop',
        detail: { kind: estimate.kind, total: estimate.total ?? 'unpriced' },
    });
}

/**
 * Confirmation plus the paid call, in one call so a caller cannot confirm and
 * then forget to guard (`0401`'s `kk music analyze` uses this).
 */
export async function withConfirmation<T>(
    estimate: SpendEstimate,
    confirmed: boolean | undefined,
    run: () => Promise<T>,
): Promise<T> {
    requireConfirmation(estimate, confirmed);
    return await run();
}

/** Scan options for {@link findRunDirDuplicates}. */
export interface DedupeScanInput {
    /** The run directory (`<works>/kk-music/<topic-slug>/`, R3's dedupe scope). */
    runDir: string;
    /** Digests of the takes this invocation would request. */
    digests: readonly TakeDigestEntry[];
    /** File-system seam; defaults to the node/bun backend. */
    fileSystem?: FileSystem;
}

/** Read a sidecar's two fields the scan needs, tolerating a malformed file. */
function readSidecarRecord(raw: string): { digest: string; artifactPath: string | null } | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return null;
    }
    const record = parsed as Record<string, unknown>;
    const digest = record.digest;
    if (typeof digest !== 'string' || digest === '') {
        return null;
    }
    const artifactPath = record.artifactPath;
    return { digest, artifactPath: typeof artifactPath === 'string' ? artifactPath : null };
}

/**
 * Find takes already paid for in this run directory (R3).
 *
 * The scope lives in the lookup location, not the digest: only `runDir`'s own
 * `*.take.json` sidecars are read, so another topic's run directory — or the
 * instance library — can never produce a false duplicate. A sidecar that cannot
 * be parsed cannot be shown to match, so it is skipped rather than blocking the
 * run.
 */
export async function findRunDirDuplicates(input: DedupeScanInput): Promise<RunDirDuplicate[]> {
    const fileSystem = input.fileSystem ?? createNodeFileSystem();
    if (input.digests.length === 0) {
        return [];
    }
    if (!(await fileSystem.exists(input.runDir))) {
        return [];
    }
    const wanted = new Map<string, number[]>();
    for (const entry of input.digests) {
        const indexes = wanted.get(entry.digest);
        if (indexes === undefined) {
            wanted.set(entry.digest, [entry.takeIndex]);
        } else {
            indexes.push(entry.takeIndex);
        }
    }
    const names = await fileSystem.readDir(input.runDir);
    const duplicates: RunDirDuplicate[] = [];
    for (const name of [...names].sort()) {
        if (!name.endsWith(TAKE_SIDECAR_SUFFIX)) {
            continue;
        }
        const sidecarPath = join(input.runDir, name);
        const record = readSidecarRecord(await fileSystem.readFile(sidecarPath));
        if (record === null) {
            continue;
        }
        const indexes = wanted.get(record.digest);
        if (indexes === undefined) {
            continue;
        }
        const artifactPath =
            record.artifactPath ?? join(input.runDir, name.slice(0, name.length - TAKE_SIDECAR_SUFFIX.length));
        for (const takeIndex of indexes) {
            duplicates.push({ takeIndex, digest: record.digest, artifactPath, sidecarPath });
        }
    }
    return duplicates;
}

/** The decision {@link planGeneration} makes about a duplicate run (R3). */
export interface DedupeDecision {
    /** Takes the earlier run already paid for. */
    duplicates: RunDirDuplicate[];
    /** Whether this invocation proceeds past dedupe (only with `--force --reason`). */
    forced: boolean;
    reason: string | null;
}

/**
 * Apply R3's dedupe policy: refuse on a duplicate unless `--force --reason`
 * overrides it, and never accept `--force` without a reason.
 */
export async function enforceRunScopedDedupe(
    input: DedupeScanInput & { force?: boolean; reason?: string },
): Promise<DedupeDecision> {
    const duplicates = await findRunDirDuplicates(input);
    const forced = input.force === true;
    const reason = input.reason ?? null;
    if (forced && (reason === null || reason.trim() === '')) {
        throw new SpendRefusal('--force re-pays for a request this run already owns, but no --reason was given', {
            flag: '--reason',
            remedy: 'pass --force --reason "<why the re-roll is worth paying for>"',
        });
    }
    if (duplicates.length > 0 && !forced) {
        const first = duplicates[0] as RunDirDuplicate;
        throw new SpendRefusal(
            `take ${String(first.takeIndex + 1)} of this request is already paid for in this run directory: ${first.artifactPath} (digest ${first.digest})`,
            {
                flag: '--force --reason <text>',
                remedy: `pass --force --reason "<why>" to re-roll it — a re-roll is paid again — or reuse ${first.artifactPath}`,
                detail: {
                    artifactPath: first.artifactPath,
                    digest: first.digest,
                    duplicates: duplicates.length,
                },
            },
        );
    }
    return { duplicates, forced, reason: forced ? reason : null };
}

/** Input for {@link planGeneration}. */
export interface GenerationPlanInput {
    job: ResolvedJob;
    prices: MusicPrices;
    /** Effective cap — `MusicConfig.takesCap`, already validated by {@link resolveTakesCap}. */
    takesCap: number;
    /** `--takes`, when the caller overrode the brief's count. */
    requestedTakes?: number;
    confirmed?: boolean;
    force?: boolean;
    reason?: string;
    /** The run directory: where sidecars live and where dedupe looks. */
    runDir: string;
    /** SHA-256 of each brief image, in brief order (empty when the brief has none). */
    imageHashes: readonly string[];
    /** Receives the rendered estimate before any refusal, so R2 can print then fail. */
    emit?: SpendEmit;
    fileSystem?: FileSystem;
}

/** What {@link planGeneration} approves: everything the take loop needs, and nothing it may expand. */
export interface GenerationPlan {
    estimate: SpendEstimate;
    takes: number;
    /** One digest per take, in take order. */
    digests: TakeDigest[];
    forced: boolean;
    reason: string | null;
    duplicates: RunDirDuplicate[];
}

/**
 * The generate guard: cap, estimate, confirmation, dedupe — in that order, all
 * before the adapter exists. It throws {@link SpendRefusal} rather than returning
 * a decision, so no caller can hold a plan it forgot to check.
 */
export async function planGeneration(input: GenerationPlanInput): Promise<GenerationPlan> {
    const takes = resolveTakeCount(input.requestedTakes ?? input.job.takes, input.takesCap);
    const estimate = estimateGenerate({ job: input.job, prices: input.prices, takes });
    input.emit?.(formatEstimate(estimate));
    requireConfirmation(estimate, input.confirmed);
    const digests = Array.from({ length: takes }, (_unused, takeIndex) =>
        takeDigest(input.job, { imageHashes: [...input.imageHashes], takeIndex }),
    );
    const decision = await enforceRunScopedDedupe({
        runDir: input.runDir,
        digests: digests.map((digest, takeIndex) => ({ takeIndex, digest: digest.sha256 })),
        ...(input.force === undefined ? {} : { force: input.force }),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        ...(input.fileSystem === undefined ? {} : { fileSystem: input.fileSystem }),
    });
    return {
        estimate,
        takes,
        digests,
        forced: decision.forced,
        reason: decision.reason,
        duplicates: decision.duplicates,
    };
}
