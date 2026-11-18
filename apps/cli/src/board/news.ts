import { createHash } from 'node:crypto';
import type {
    ArtifactDescriptor,
    BoardDiagnostic,
    RunCapture,
    RunResults,
    WorkflowName,
} from '@gobing-ai/kk-board/contracts';
import { z } from 'zod';
import { PublishWindowSchema, ReceiptSchema } from '../publish-core';
import { PublishOutcomeSchema, PublishPlanSchema } from '../publish-matrix';
import {
    type ArtifactObservation,
    descriptorFor,
    isTerminalStatus,
    markerDiagnostic,
    overallAvailability,
    type RunDetailSummary,
} from './collect';
import { type DailyProgress, dagProducerState, projectProgress } from './daily-voice';
import { type ArtifactSpec, artifactsFor, type MarkerState, type ProducerState, resolveAvailability } from './manifest';

/**
 * The news projection (task 0391, G61 successor): bind a current `kk-news-generate` launch attempt
 * to the Board's read-only evidence routes WITHOUT disturbing verified voice2 history.
 *
 * Honesty rules (§9, unchanged):
 * - Semantic outcomes derive only from files the run itself recorded, read through the reader's
 *   containment discipline; anything the run did not record stays `unavailable`/`null`, never
 *   invented.
 * - Publish provenance binds each plan/receipt/outcome file to THIS attempt by identity (run id,
 *   bundle identity, run date, plan digest) — never by timestamp or directory name. A file that
 *   fails its identity check is reported as a mismatched diagnostic and its contents are not
 *   surfaced.
 * - Diagnostics are bounded and reference artifacts by id and availability; no browser-supplied or
 *   plan-derived path is ever accepted as a read target beyond a validated receipt id.
 */

/** The publish windows the matrix can plan (the frozen `PublishWindowSchema` vocabulary). */
const PUBLISH_WINDOWS = PublishWindowSchema.options;

/** Receipt/plan row ids are run-id-shaped tokens, never paths: gate the receipt read on this. */
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Bounded launch-receipt projection: the attempt fields the deliverables UI needs. */
const LaunchReceiptSchema = z
    .object({
        runId: z.string().min(1).optional(),
        status: z.string().min(1),
        startedAt: z.string().min(1).optional(),
        finishedAt: z.string().min(1).optional(),
        command: z.string().min(1).optional(),
        reason: z.string().min(1).optional(),
    })
    .strip();

/** This attempt's launcher receipt as bounded evidence, flagged stale when it names another run. */
export interface NewsLaunchEvidence {
    /** The launcher's own receipt status (`running` | `done` | `refused` | `no-content`). */
    status: string | null;
    runId: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    reason: string | null;
    /** Set when the recorded receipt names a DIFFERENT run than the selected attempt. */
    stale: boolean;
}

/** One engine node's producer state and its bounded recorded attempts. */
export interface NewsEngineAttempt {
    node: string;
    state: ProducerState;
    /** Recorded attempts for the node, oldest last, bounded. */
    attempts: { status: string; timing: string }[];
}

/** The attempt's generation side: outcome, pool-gate verdict, launch receipt, engines and progress. */
export interface NewsGenerationEvidence {
    /** `no-content` | launcher receipt status override | null when nothing recorded it. */
    outcome: string | null;
    /** The pool gate verdict (`PASS` | `EMPTY` | unrecognized-but-recorded). */
    gate: { status: string | null };
    launch: NewsLaunchEvidence;
    /** The voice chain and other loud fallbacks, one row per DAG node. */
    engines: NewsEngineAttempt[];
    /** The 0378 status projection over the run's recorded step timing + topology. */
    progress: DailyProgress | null;
}

/** The recorded bundle's bounded identity card: run date, parent run, title, variants and safety. */
export interface NewsBundleEvidence {
    /** The bundle identity (`<runDate>-<parentRunId>`), never a filesystem path. */
    identity: string;
    runDate: string;
    parentRunId: string | null;
    title: string | null;
    /** Frozen variant names (the record keys), sorted and bounded. */
    variants: string[];
    safety: string | null;
}

/** One publish target's plan-and-receipt evidence: send status, delivery effect and fixed references. */
export interface NewsPublishTarget {
    /** The plan row / receipt target id — an opaque token, never a path. */
    id: string;
    tier: number | null;
    mode: string | null;
    /** The preset target name (e.g. the plugin channel), when the row recorded one. */
    target: string | null;
    status: 'succeeded' | 'failed' | 'uncertain' | 'planned' | 'dummy' | 'skipped';
    /** Delivery effect the receipt recorded, kept separate from the send status. */
    effect: 'confirmed' | 'none' | 'unknown' | null;
    url: string | null;
    guid: string | null;
    finishedAt: string | null;
    /** Bounded failure text from the receipt/plan exclusion, when recorded. */
    error: string | null;
    /** Evidence references — fixed workspace-relative files, never client-supplied paths. */
    evidence: { plan: string; receipt: string | null };
}

/** One publish window's recorded evidence: planned targets, outcome status and provenance checks. */
export interface NewsPublishWindow {
    window: (typeof PUBLISH_WINDOWS)[number];
    /** The recorded outcome file's status; null when the window recorded no readable outcome. */
    recordedStatus: 'full' | 'partial' | 'none' | 'dummy' | null;
    /** Identity checks binding the plan to THIS attempt; null = the check could not run. */
    provenance: {
        dateMatch: boolean | null;
        bundleMatch: boolean | null;
        parentMatch: boolean | null;
        digestMatch: boolean | null;
    };
    targets: NewsPublishTarget[];
}

/** The attempt's publishing side: the bundle card plus one window group per publishable window. */
export interface NewsPublishingEvidence {
    bundle: NewsBundleEvidence | null;
    windows: NewsPublishWindow[];
}

/** The typed news summary carried under `RunResults.summary`: generation and publishing plus counts. */
export interface NewsSummary {
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    outcome: string | null;
    generation: NewsGenerationEvidence;
    publishing: NewsPublishingEvidence;
    counts: {
        artifactsAvailable: number;
        artifactsTotal: number;
        targetsSucceeded: number;
        targetsFailed: number;
        targetsUncertain: number;
        targetsPlanned: number;
        windowsFull: number;
        windowsPartial: number;
        windowsNone: number;
    };
}

/** One bounded diagnostic line, capped so a pathological workspace cannot flood the envelope. */
const MAX_DIAGNOSTICS = 16;

const MAX_TARGETS_PER_WINDOW = 16;

const MAX_ATTEMPTS_PER_NODE = 4;

const MAX_VARIANTS = 12;

function boundedText(value: unknown, cap = 240): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text === '' ? null : text.length > cap ? `${text.slice(0, cap)}…` : text;
}

function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function parseJsonOrNull(text: string | undefined): Record<string, unknown> | null {
    if (text === undefined) return null;
    try {
        return asRecordOrNull(JSON.parse(text));
    } catch {
        return null;
    }
}

/** Recorded timing for one action row (`12s` | `started → completed` | `timing unknown`). */
function rowTiming(record: Record<string, unknown>): string {
    const durationMs = record.durationMs;
    if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0) {
        return durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${Math.round(durationMs / 1000)}s`;
    }
    const started = stringOrNull(record.startedAt);
    const completed = stringOrNull(record.completedAt);
    return started !== null && completed !== null ? `${started} → ${completed}` : 'timing unknown';
}

/**
 * The voice chain and other loud fallbacks as bounded engine attempts: one row per node, its
 * producer state resolved from the recorded action rows, and up to
 * {@link MAX_ATTEMPTS_PER_NODE} recorded attempts with their timing.
 */
function engineAttempts(actions: readonly unknown[], nodes: readonly string[]): NewsEngineAttempt[] {
    return nodes.map((node) => {
        const attempts = actions
            .map((entry) => asRecordOrNull(entry))
            .filter((record): record is Record<string, unknown> => record !== null && record.node === node)
            .slice(-MAX_ATTEMPTS_PER_NODE)
            .map((record) => ({
                status: stringOrNull(record.status) ?? (record.ok === true ? 'passed' : 'unknown'),
                timing: rowTiming(record),
            }));
        return { node, state: dagProducerState(actions, node), attempts };
    });
}

/** The launcher's own attempt receipt, bounded and staleness-checked against the selected run. */
function launchEvidence(receiptText: string | undefined, runId: string): NewsLaunchEvidence {
    const parsed = receiptText === undefined ? null : LaunchReceiptSchema.safeParse(parseJsonOrNull(receiptText));
    const receipt = parsed?.success ? parsed.data : null;
    const receiptRunId = stringOrNull(receipt?.runId);
    return {
        status: stringOrNull(receipt?.status),
        runId: receiptRunId,
        startedAt: stringOrNull(receipt?.startedAt),
        finishedAt: stringOrNull(receipt?.finishedAt),
        reason: stringOrNull(receipt?.reason),
        stale: receiptRunId !== null && receiptRunId !== runId,
    };
}

/**
 * Per-window publish evidence: the plan, its receipts and the outcome file, each bound to THIS
 * attempt by identity. Only files that pass their identity checks contribute target facts; a
 * failed check keeps the target's plan-side facts and flips the matching provenance bit with a
 * diagnostic, never a fabricated status.
 */
async function publishingEvidence(input: {
    runId: string;
    stamp: string;
    markerOwned: boolean;
    bundle: NewsBundleEvidence | null;
    readWorkspaceFile: (relative: string, kind: 'text' | 'json') => Promise<ArtifactObservation>;
    pushDiagnostic: (diagnostic: BoardDiagnostic) => void;
}): Promise<NewsPublishingEvidence> {
    const { runId, stamp, bundle, readWorkspaceFile, pushDiagnostic } = input;

    // A workspace the Board no longer owns serves no publish bytes at all: the successor's
    // plan/receipts must not leak through a stale selection (§9).
    if (!input.markerOwned) return { bundle: null, windows: [] };

    const windows: NewsPublishWindow[] = [];
    for (const window of PUBLISH_WINDOWS) {
        const planPath = `4-publish/plan.${window}.json`;
        const planObservation = await readWorkspaceFile(planPath, 'json');
        if (planObservation.state !== 'present' || planObservation.text === undefined) {
            // An unplanned window is normal (the preset may omit it) — recorded as an empty
            // group without diagnostics, mirroring the matrix's own absent-window handling.
            windows.push({
                window,
                recordedStatus: null,
                provenance: { dateMatch: null, bundleMatch: null, parentMatch: null, digestMatch: null },
                targets: [],
            });
            continue;
        }
        const plan = PublishPlanSchema.safeParse(parseJsonOrNull(planObservation.text));
        if (!plan.success) {
            pushDiagnostic({
                code: 'board.publish.plan-invalid',
                message: `The recorded ${window} publish plan is malformed; its contents are not surfaced.`,
            });
            windows.push({
                window,
                recordedStatus: null,
                provenance: { dateMatch: null, bundleMatch: null, parentMatch: null, digestMatch: null },
                targets: [],
            });
            continue;
        }
        const planData = plan.data;
        // Plan bytes are hashed exactly as read — the writer hashed the same bytes it wrote.
        const planDigest = createHash('sha256').update(planObservation.text).digest('hex');
        const expectedParent = bundle?.parentRunId ?? runId;
        const provenance = {
            dateMatch: planData.runDate === undefined ? null : planData.runDate === stamp,
            bundleMatch: bundle === null ? null : planData.bundleRunId === bundle.identity,
            parentMatch: planData.parentRunId === expectedParent,
            digestMatch: null as boolean | null,
        };
        const windowTargets: NewsPublishTarget[] = [];
        for (const row of planData.rows.slice(0, MAX_TARGETS_PER_WINDOW)) {
            const base = {
                id: row.id,
                tier: row.tier,
                mode: row.mode,
                target: null as string | null,
                status: row.mode === 'dummy' ? ('dummy' as const) : ('planned' as const),
                effect: null,
                url: null,
                guid: null,
                finishedAt: null,
                error: null,
                evidence: { plan: planPath, receipt: null as string | null },
            };
            if (!SAFE_TOKEN.test(row.id)) {
                pushDiagnostic({
                    code: 'board.publish.receipt-refused',
                    message: `Plan target id '${row.id}' is not a safe token; its receipt was never read.`,
                });
                windowTargets.push(base);
                continue;
            }
            const receiptPath = `4-publish/receipts/${row.id}.json`;
            const receiptObservation = await readWorkspaceFile(receiptPath, 'json');
            if (receiptObservation.state !== 'present' || receiptObservation.text === undefined) {
                // A planned row with no receipt is `missing` in the matrix's own words — it
                // counts as not succeeded and never reads as published.
                windowTargets.push(base);
                continue;
            }
            const receipt = ReceiptSchema.safeParse(parseJsonOrNull(receiptObservation.text));
            if (!receipt.success) {
                pushDiagnostic({
                    code: 'board.publish.receipt-invalid',
                    message: `The recorded receipt for target '${row.id}' is malformed; its contents are not surfaced.`,
                });
                windowTargets.push({
                    ...base,
                    status: 'uncertain',
                    evidence: { plan: planPath, receipt: receiptPath },
                });
                continue;
            }
            const receiptData = receipt.data;
            // Provenance: the receipt must name this plan (digest) and this attempt (parent),
            // and a matrix receipt must name its own target. A mismatched receipt is untrusted:
            // its send facts stay unsurfaced and the digest bit records the failure.
            const identityOk =
                receiptData.planDigest === planDigest &&
                receiptData.parentRunId === planData.parentRunId &&
                (receiptData.target === undefined || receiptData.target === row.id) &&
                (receiptData.window === undefined || receiptData.window === window);
            if (!identityOk) {
                provenance.digestMatch = false;
                pushDiagnostic({
                    code: 'board.publish.receipt-mismatch',
                    message: `The recorded receipt for target '${row.id}' does not bind to this attempt's plan (digest/parent/window); it is not treated as evidence.`,
                });
                windowTargets.push({
                    ...base,
                    status: 'uncertain',
                    evidence: { plan: planPath, receipt: receiptPath },
                });
                continue;
            }
            provenance.digestMatch = true;
            windowTargets.push({
                id: row.id,
                tier: row.tier,
                mode: receiptData.dummy === true ? 'dummy' : receiptData.mode,
                target: stringOrNull(receiptData.target),
                status: receiptData.status,
                effect: receiptData.effect,
                url: stringOrNull(receiptData.url),
                guid: stringOrNull(receiptData.guid),
                finishedAt: stringOrNull(receiptData.finishedAt),
                error: boundedText(receiptData.error),
                evidence: { plan: planPath, receipt: receiptPath },
            });
        }
        // The outcome file is the window's own recorded group truth; it is surfaced only when it
        // names this window and this run date. A disagreement with the receipt-derived statuses is
        // a diagnostic, never a silent override.
        const outcomeObservation = await readWorkspaceFile(`4-publish/outcome.${window}.json`, 'json');
        let recordedStatus: NewsPublishWindow['recordedStatus'] = null;
        if (outcomeObservation.state === 'present' && outcomeObservation.text !== undefined) {
            const outcome = PublishOutcomeSchema.safeParse(parseJsonOrNull(outcomeObservation.text));
            if (outcome.success && outcome.data.window === window) {
                if (outcome.data.runDate === stamp) {
                    recordedStatus = outcome.data.status;
                    const receiptStatuses = new Map(windowTargets.map((target) => [target.id, target.status]));
                    for (const row of outcome.data.rows) {
                        const derived = receiptStatuses.get(row.id);
                        const recorded = row.status === 'missing' ? 'planned' : row.status;
                        if (derived !== undefined && derived !== recorded) {
                            pushDiagnostic({
                                code: 'board.publish.outcome-disagreement',
                                message: `The recorded ${window} outcome says '${row.id}' is '${recorded}' while its receipt says '${derived}'; both files are surfaced as recorded.`,
                            });
                        }
                    }
                } else {
                    pushDiagnostic({
                        code: 'board.publish.outcome-mismatch',
                        message: `The recorded ${window} outcome names run date '${outcome.data.runDate}', not this attempt's '${stamp}'; it is not surfaced.`,
                    });
                }
            } else {
                pushDiagnostic({
                    code: 'board.publish.outcome-invalid',
                    message: `The recorded ${window} outcome file is malformed; its contents are not surfaced.`,
                });
            }
        }
        for (const excluded of planData.excluded.slice(0, MAX_TARGETS_PER_WINDOW)) {
            if (!SAFE_TOKEN.test(excluded.id)) continue;
            windowTargets.push({
                id: excluded.id,
                tier: null,
                mode: null,
                target: null,
                status: 'skipped',
                effect: null,
                url: null,
                guid: null,
                finishedAt: null,
                error: boundedText(excluded.reason),
                evidence: { plan: planPath, receipt: null },
            });
        }
        windows.push({ window, recordedStatus, provenance, targets: windowTargets });
    }
    return { bundle, windows };
}

/** The frozen bundle's bounded projection — identity and names, never payload digests. */
function bundleEvidence(
    text: string | undefined,
    available: boolean,
): { bundle: NewsBundleEvidence | null; invalid: boolean } {
    if (!available) return { bundle: null, invalid: false };
    const record = parseJsonOrNull(text);
    if (record === null) return { bundle: null, invalid: true };
    const identity = stringOrNull(record.runId);
    if (identity === null) return { bundle: null, invalid: true };
    const episode = asRecordOrNull(record.episode);
    const variantsRecord = asRecordOrNull(record.variants);
    const variants = variantsRecord === null ? [] : Object.keys(variantsRecord).sort().slice(0, MAX_VARIANTS);
    return {
        bundle: {
            identity,
            runDate: stringOrNull(record.runDate) ?? '',
            parentRunId: stringOrNull(record.parentRunId),
            title: stringOrNull(episode?.title),
            variants,
            safety: stringOrNull(asRecordOrNull(record.safety)?.status),
        },
        invalid: false,
    };
}

/**
 * Project one news run's results. Pure over the reader-supplied observations, the run-detail
 * action rows, and the reader's contained workspace reads (publish evidence). Same envelope as
 * the other projections; `summary` is the news DTO (schemaVersion stays 1).
 */
export async function projectNewsResults(input: {
    record: RunCapture;
    detail: RunDetailSummary;
    marker: MarkerState;
    actions: readonly unknown[];
    producerOf: (spec: ArtifactSpec) => ProducerState;
    observationOf: (spec: ArtifactSpec) => ArtifactObservation | undefined;
    readWorkspaceFile: (relative: string, kind: 'text' | 'json') => Promise<ArtifactObservation>;
    diagnostics?: BoardDiagnostic[];
}): Promise<RunResults> {
    const { record, detail, marker } = input;
    const terminal = isTerminalStatus(detail.status);
    const specs = artifactsFor(record.workflow as WorkflowName);
    const diagnostics: BoardDiagnostic[] = [...(input.diagnostics ?? []), ...markerDiagnostic(marker)];
    const pushDiagnostic = (diagnostic: BoardDiagnostic): void => {
        if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(diagnostic);
    };
    const availability = new Map<string, ArtifactDescriptor['availability']>();
    const artifacts: ArtifactDescriptor[] = [];
    for (const spec of specs) {
        const observation = input.observationOf(spec);
        const state = resolveAvailability(marker, input.producerOf(spec), observation?.state ?? 'absent', terminal);
        availability.set(spec.id, state);
        artifacts.push(descriptorFor(spec, state, observation));
    }
    const textOf = (id: string): string | undefined => {
        if (availability.get(id) !== 'available') return undefined;
        const spec = specs.find((candidate) => candidate.id === id);
        return spec === undefined ? undefined : input.observationOf(spec)?.text;
    };
    const jsonOf = (id: string): Record<string, unknown> | null => parseJsonOrNull(textOf(id));

    // ---- generation evidence ----
    const launchReceipt = await input.readWorkspaceFile('schedule-receipt.json', 'json');
    const launch =
        launchReceipt.state === 'present'
            ? launchEvidence(launchReceipt.text, record.runId)
            : {
                  status: null,
                  runId: null,
                  startedAt: null,
                  finishedAt: null,
                  reason: null,
                  stale: false,
              };
    if (launch.stale) {
        pushDiagnostic({
            code: 'board.launch.receipt-mismatch',
            message: `The workspace's launch receipt names run '${launch.runId}', not this attempt; it is reported but not treated as this attempt's outcome.`,
        });
    }
    if (launch.status === null && launchReceipt.state !== 'absent') {
        pushDiagnostic({
            code: 'board.launch.receipt-invalid',
            message: 'The recorded launch receipt is malformed; its contents are not surfaced.',
        });
    }

    const gateRecord = jsonOf('pool-gate');
    const gate = { status: stringOrNull(gateRecord?.status) };

    const noContentText = textOf('no-content');
    const outcome = noContentText?.trim().startsWith('no-content:') === true ? 'no-content' : (launch.status ?? null);

    const engines = engineAttempts(input.actions, ['voice', 'voice-fallback', 'voice-fallback2']);

    // ---- publishing evidence ----
    const bundleAvailable = availability.get('bundle') === 'available';
    const bundleParsed = bundleEvidence(textOf('bundle'), bundleAvailable);
    if (bundleParsed.invalid) {
        pushDiagnostic({
            code: 'board.publish.bundle-invalid',
            message: 'The recorded bundle is malformed; publish provenance falls back to run identity.',
        });
    }
    const publishing = await publishingEvidence({
        runId: record.runId,
        stamp: record.stamp,
        markerOwned: marker === 'owned',
        bundle: bundleParsed.bundle,
        readWorkspaceFile: input.readWorkspaceFile,
        pushDiagnostic,
    });

    const summary: NewsSummary = {
        status: stringOrNull(detail.status) ?? detail.status,
        startedAt: detail.startedAt ?? null,
        completedAt: detail.completedAt ?? null,
        outcome,
        generation: {
            outcome,
            gate,
            launch,
            engines,
            progress: projectProgress(input.actions, record.topology),
        },
        publishing,
        counts: {
            artifactsAvailable: artifacts.filter((artifact) => artifact.availability === 'available').length,
            artifactsTotal: artifacts.length,
            targetsSucceeded: publishing.windows
                .flatMap((window) => window.targets)
                .filter((target) => target.status === 'succeeded').length,
            targetsFailed: publishing.windows
                .flatMap((window) => window.targets)
                .filter((target) => target.status === 'failed').length,
            targetsUncertain: publishing.windows
                .flatMap((window) => window.targets)
                .filter((target) => target.status === 'uncertain').length,
            targetsPlanned: publishing.windows
                .flatMap((window) => window.targets)
                .filter((target) => target.status === 'planned').length,
            windowsFull: publishing.windows.filter((window) => window.recordedStatus === 'full').length,
            windowsPartial: publishing.windows.filter((window) => window.recordedStatus === 'partial').length,
            windowsNone: publishing.windows.filter((window) => window.recordedStatus === 'none').length,
        },
    };
    if (!summary.generation.progress?.edgesKnown) {
        diagnostics.push({
            code: 'board.progress.topology-unknown',
            message:
                'No digest-verified topology was captured; dependency edges are unknown (see Settings → Workflows).',
        });
    }
    return {
        schemaVersion: 1,
        workflow: record.workflow as WorkflowName,
        runId: record.runId,
        availability: overallAvailability(artifacts.map((artifact) => artifact.availability)),
        summary: summary as unknown as Record<string, unknown>,
        artifacts,
        diagnostics,
    };
}
