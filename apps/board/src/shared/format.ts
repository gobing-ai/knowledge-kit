import type { Availability, BoardDiagnostic } from '../contracts';

/**
 * Availability and diagnostic formatting shared by the tabs.
 *
 * Every availability value has its own operator-facing label: no missing state collapses
 * into "unavailable", so a superseded artifact can never read as a missing one.
 */

/** Tones the UI maps to colour + text; text is always present alongside colour. */
export type AvailabilityTone = 'ok' | 'pending' | 'warn' | 'error';

/** The operator-facing label for an artifact/summary availability. */
export function availabilityLabel(availability: Availability): string {
    switch (availability) {
        case 'available':
            return 'Available';
        case 'pending':
            return 'Not yet written';
        case 'missing':
            return 'Missing';
        case 'invalid':
            return 'Malformed';
        case 'oversized':
            return 'Too large to preview';
        case 'superseded':
            return 'Superseded by a later run';
        case 'unverified':
            return 'Unverified';
    }
}

/** The tone an availability maps to (text is rendered with it, never colour alone). */
export function availabilityTone(availability: Availability): AvailabilityTone {
    switch (availability) {
        case 'available':
            return 'ok';
        case 'pending':
            return 'pending';
        case 'missing':
        case 'oversized':
        case 'unverified':
            return 'warn';
        case 'invalid':
        case 'superseded':
            return 'error';
    }
}

/** One bounded line for a diagnostic: `<code>: <message>`. */
export function diagnosticLine(diagnostic: BoardDiagnostic): string {
    return `${diagnostic.code}: ${diagnostic.message}`;
}

/** A byte count, or an explicit unknown — never `0 B` for a file we did not measure. */
export function formatBytes(bytes: number | undefined): string {
    if (bytes === undefined) return 'size unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Elapsed time between an ISO start and `now`, or an explicit unknown. */
export function formatElapsed(startedAt: string | null | undefined, now: number): string {
    if (startedAt === null || startedAt === undefined) return 'elapsed unknown';
    const start = Date.parse(startedAt);
    if (Number.isNaN(start)) return 'elapsed unknown';
    const seconds = Math.max(0, Math.round((now - start) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Collapse repeated diagnostics to one row per code. The UI keys rows by code and the loaders push a
 * fresh diagnosis on every failed poll, so without this a flapping reader grows duplicate React keys
 * and a list that never shrinks. First occurrence wins (the earliest state is the informative one).
 */
export function dedupeDiagnostics(diagnostics: readonly BoardDiagnostic[]): BoardDiagnostic[] {
    const seen = new Set<string>();
    return diagnostics.filter((diagnostic) => {
        if (seen.has(diagnostic.code)) return false;
        seen.add(diagnostic.code);
        return true;
    });
}

/** Local timestamp with the UTC detail appended, so two operators can compare runs. */
export function formatTimestamp(iso: string | null | undefined): string {
    if (iso === null || iso === undefined) return 'time unknown';
    const epoch = Date.parse(iso);
    if (Number.isNaN(epoch)) return 'time unknown';
    return `${new Date(epoch).toLocaleString()} (${new Date(epoch).toISOString()})`;
}
