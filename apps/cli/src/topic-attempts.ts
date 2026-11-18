/**
 * Reader/projection for the versioned per-attempt selection-counts artifact (task 0392 R14).
 *
 * The QC/curation stage (plugins/kk/scripts/topic-selection-attempts.ts) owns writing
 * `21-plan/topic-selection-attempts.json`; this module only reads it, so BOTH run-report paths can
 * say how the pool shrank:
 *  - the ordinary path appends the markdown section to the report body,
 *  - the no-content path appends the one-line note to the refusal reason the ledger mirrors.
 *
 * Duplication of the shape (not of the writer) is deliberate: this file cannot import from
 * `plugins/`, exactly like the bigram-Jaccard twin in `daily.ts`. Every field is tolerated as
 * missing, because an older or partial artifact must degrade to "unknown", never to a fabricated
 * zero. The module is a pure projection (no fs): `daily.ts` reads the artifact on this sync path.
 */
const parseJson: (raw: string) => unknown = JSON.parse;

/** What both report paths need about the day's selection attempts. */
export interface SelectionAttemptsView {
    version: number;
    specVersion: number;
    attempts: number;
    /** Latest attempt's counts; `null` = the stage left no evidence (unknown, not zero). */
    preFilter: number | null;
    kept: number | null;
    uniqueExcluded: number | null;
    /** Sum of the latest attempt's per-rule hits — NOT comparable to `uniqueExcluded`. */
    ruleHits: number;
    /** Candidate IDs the day excluded under ≥2 distinct rules. */
    multipleHits: number;
    zeroKept: boolean;
    reconciled: boolean;
    skippedStages: string[];
    issues: string[];
}

function count(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Parse the artifact text into the view the report consumes. An unparsable, shapeless or
 * newer-versioned artifact is `null`; the report then prints nothing (unknown), which is what the
 * ledger should say when the stage never recorded counts. Reading the file is the caller's job —
 * `daily.ts` owns the sync fs access on this path (see runtime-boundaries.yaml's exemption).
 */
export function parseSelectionAttempts(raw: string): SelectionAttemptsView | null {
    let parsed: unknown;
    try {
        parsed = parseJson(raw);
    } catch {
        return null;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const artifact = parsed as Record<string, unknown>;
    const attempts = Array.isArray(artifact.attempts) ? (artifact.attempts as Record<string, unknown>[]) : [];
    const latest = attempts[attempts.length - 1];
    if (latest === undefined || latest === null || typeof latest !== 'object') return null;
    const counts = (latest.counts ?? {}) as Record<string, unknown>;
    const reconciliation = (artifact.reconciliation ?? {}) as Record<string, unknown>;
    const issues = Array.isArray(reconciliation.issues) ? reconciliation.issues.map((issue) => String(issue)) : [];
    return {
        version: count(artifact.version) ?? 0,
        specVersion: count(artifact.specVersion) ?? 0,
        attempts: attempts.length,
        preFilter: count(counts.preFilter),
        kept: count(counts.kept),
        uniqueExcluded: count(counts.uniqueExcluded),
        ruleHits: count(reconciliation.ruleHits) ?? 0,
        multipleHits: count(reconciliation.multipleHits) ?? 0,
        zeroKept: reconciliation.zeroKept === true,
        reconciled: reconciliation.reconciled === true,
        skippedStages: Array.isArray(reconciliation.skippedStages)
            ? reconciliation.skippedStages.map((stage) => String(stage))
            : [],
        issues,
    };
}

/** Stage-name list for the human line; an empty list means every stage left evidence. */
function stageNote(view: SelectionAttemptsView): string {
    return view.skippedStages.length === 0 ? 'no unknown stages' : `unknown: ${view.skippedStages.join(', ')}`;
}

/**
 * The one-line note appended to the `no-content` reason (R14: the refusal must name what was lost
 * and whether the loss is counted as unique IDs or rule hits).
 */
export function selectionAttemptsNote(view: SelectionAttemptsView | null): string {
    if (view === null) return '';
    const kept = view.kept === null ? 'unknown' : String(view.kept);
    const excluded = view.uniqueExcluded === null ? 'unknown' : String(view.uniqueExcluded);
    const preFilter = view.preFilter === null ? 'unknown' : String(view.preFilter);
    const reconcile = view.reconciled ? 'counts reconcile' : 'counts do not reconcile';
    return ` — selection attempts ${view.attempts} (spec v${view.specVersion}): pre-filter ${preFilter} → kept ${kept}, ${excluded} unique excluded ID(s) across ${view.ruleHits} rule hit(s)${view.multipleHits > 0 ? `, ${view.multipleHits} multi-rule ID(s)` : ''}; ${reconcile}; ${stageNote(view)}`;
}

/**
 * The markdown section appended to the ordinary report: one row per attempt so a retry is visible
 * rather than silently overwriting the attempt it replaced.
 */
export function selectionAttemptsSection(view: SelectionAttemptsView | null): string {
    if (view === null) return '';
    const cell = (value: number | null): string => (value === null ? 'unknown' : String(value));
    const lines = [
        '## Topic selection',
        '',
        `- Rule spec v${view.specVersion}, counts artifact v${view.version}, ${view.attempts} attempt(s) recorded`,
        `- Latest attempt: pre-filter ${cell(view.preFilter)} → kept ${cell(view.kept)}, ${cell(view.uniqueExcluded)} unique excluded ID(s); ${view.ruleHits} rule hit(s) (hits are not unique IDs), ${view.multipleHits} ID(s) hit by more than one rule`,
        `- Reconciliation: ${view.reconciled ? 'pre-filter = kept + unique excluded + deduped' : 'MISMATCH — see issues'}${view.zeroKept ? '; zero kept is a valid outcome' : ''}`,
        `- Stage evidence: ${stageNote(view)}`,
        ...view.issues.map((issue) => `- Issue: ${issue}`),
        '',
    ];
    return lines.join('\n');
}

/** Append the section to a finished report body, leaving the body untouched when nothing is known. */
export function appendSelectionAttempts(body: string, view: SelectionAttemptsView | null): string {
    const section = selectionAttemptsSection(view);
    return section === '' ? body : `${body.trimEnd()}\n\n${section}`;
}
