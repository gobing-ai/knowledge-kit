import type { BoardDiagnostic } from '../contracts';

/**
 * Device-side run selection and deep-link resolution.
 *
 * Pure and DOM-free so the four tabs' selection rules are unit-testable without a
 * browser (no DOM test library is installed; Playwright coverage arrives in 0255).
 */

/** The four shipped tabs, in display order. */
export type BoardTab = 'summary' | 'results' | 'progress' | 'config';

/** The four shipped tabs, in display order. */
export const BOARD_TABS: readonly BoardTab[] = ['summary', 'results', 'progress', 'config'];

/** One row of the frozen Spur run-list envelope (`/api/runs`). */
export interface RunListRow {
    id: string;
    workflowName: string;
    status: string;
    startedAt?: string | null;
}

/** The paged envelope `/api/runs` answers with (§9 frozen list shape). */
export interface RunListPage {
    runs: RunListRow[];
    count: number;
    nextCursor: string | null;
    hasMore: boolean;
}

/** The resolved selection: which run, which tab. `runId: null` is the explicit no-run state. */
export interface RunSelection {
    runId: string | null;
    tab: BoardTab;
}

/** The parsed `?run=&tab=` query, with a diagnostic for every rejected part. */
export interface DeepLink {
    runId?: string;
    tab?: BoardTab;
    diagnostics: BoardDiagnostic[];
}

/** True when `value` is one of the four shipped tabs. */
export function isBoardTab(value: string | null | undefined): value is BoardTab {
    return value !== null && value !== undefined && (BOARD_TABS as readonly string[]).includes(value);
}

/**
 * Parse the `?run=&tab=` query. An unknown tab or a blank run id is dropped with a
 * diagnostic — never silently rewritten into a different selection.
 */
export function parseDeepLink(search: string): DeepLink {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const diagnostics: BoardDiagnostic[] = [];
    const rawTab = params.get('tab');
    const rawRun = params.get('run');
    let tab: BoardTab | undefined;
    if (rawTab !== null) {
        if (isBoardTab(rawTab)) {
            tab = rawTab;
        } else {
            diagnostics.push({
                code: 'board.deeplink.unknown-tab',
                message: `Unknown tab '${rawTab}'; showing Summary.`,
            });
        }
    }
    let runId: string | undefined;
    if (rawRun !== null) {
        if (rawRun === '') {
            diagnostics.push({ code: 'board.deeplink.empty-run', message: 'Empty run id ignored.' });
        } else {
            runId = rawRun;
        }
    }
    return { ...(runId === undefined ? {} : { runId }), ...(tab === undefined ? {} : { tab }), diagnostics };
}

/**
 * Resolve the link against the loaded run rows.
 *
 * No link: the newest row wins (the documented first-visit rule). A link naming a run
 * that is not in the loaded pages yields a diagnostic and the explicit no-run state —
 * never a silent fallback onto a different run.
 */
export function resolveSelection(
    rows: readonly RunListRow[],
    link: DeepLink,
): RunSelection & { diagnostics: BoardDiagnostic[] } {
    const tab = link.tab ?? 'summary';
    const diagnostics = [...link.diagnostics];
    if (link.runId !== undefined) {
        if (rows.some((row) => row.id === link.runId)) {
            return { runId: link.runId, tab, diagnostics };
        }
        diagnostics.push({
            code: 'board.selection.unknown-run',
            message: `Run '${link.runId}' is not in the loaded history; select a run.`,
        });
        return { runId: null, tab, diagnostics };
    }
    return { runId: rows[0]?.id ?? null, tab, diagnostics };
}

/**
 * Render the selection into a deep-link query, preserving the module's OTHER parameters. §4 freezes
 * that a validated `kkApi` reader origin "is retained in saved URLs", so the selection is written
 * into the existing query rather than replacing it — a reload after a run/tab change must still find
 * the reader the operator configured.
 */
export function selectionQuery(selection: RunSelection, search = ''): string {
    const params = new URLSearchParams();
    if (selection.runId !== null) params.set('run', selection.runId);
    params.set('tab', selection.tab);
    // Keep every OTHER module parameter (a validated `kkApi` reader origin above all — §4: it "is
    // retained in saved URLs") after the selection, so the link reads run → tab → options and a reload
    // still reaches the configured reader.
    for (const [key, value] of new URLSearchParams(search)) {
        if (key === 'run' || key === 'tab') continue;
        params.set(key, value);
    }
    return `?${params.toString()}`;
}

/** The host route the Collect module is mounted at (`/modules/<id>`). */
export const COLLECT_MODULE_PATH = '/modules/kk-collect';

/** The address-bar target the selection deep-links to: the module route plus its query. */
export function selectionPath(selection: RunSelection, search = ''): string {
    return `${COLLECT_MODULE_PATH}${selectionQuery(selection, search)}`;
}

/** The slice of `window` the selection write-back touches. */
export interface SelectionUrlTarget {
    location: { pathname: string; search: string };
    history: { state: unknown; replaceState(data: unknown, unused: string, url?: string | null): void };
}

/**
 * Write the current run/tab selection back to the address bar (AC1) so a reload or a shared URL
 * restores it. The host router's own history state is passed through — only the URL changes — and
 * the call is a no-op when the address already matches, so it can never fight the router.
 */
export function syncSelectionUrl(selection: RunSelection, target: SelectionUrlTarget): void {
    // Never fight the host router: only write while this module owns the address bar.
    if (target.location.pathname !== COLLECT_MODULE_PATH) return;
    const url = selectionPath(selection, target.location.search);
    if (`${target.location.pathname}${target.location.search}` === url) return;
    target.history.replaceState(target.history.state, '', url);
}

/**
 * Append one page of runs, de-duplicating by id so a new run arriving mid-scroll never
 * duplicates or reorders the already-loaded rows.
 */
export function mergeRunPages(existing: readonly RunListRow[], page: RunListPage): RunListPage {
    const seen = new Set(existing.map((row) => row.id));
    const merged = [...existing, ...page.runs.filter((row) => !seen.has(row.id))];
    return { runs: merged, count: merged.length, nextCursor: page.nextCursor, hasMore: page.hasMore };
}
