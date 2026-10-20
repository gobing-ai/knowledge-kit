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

/**
 * The Collect module's six tabs:
 * 1. summary: Observabilities/Histories-style executive operational analytics
 * 2. runs: Run Details list with modal drilldown
 * 3. items: Items + labels joined table
 * 4. selections: Selections joined with items
 * 5. progress: Execution progress
 * 6. config: Workflow Config Summary
 */
export type CollectTab = 'summary' | 'runs' | 'items' | 'selections' | 'progress' | 'config';

/** The Collect tabs, in display order. */
export const COLLECT_TABS: readonly CollectTab[] = ['summary', 'runs', 'items', 'selections', 'progress', 'config'];

/** Shipped and legacy tab aliases: `overview` maps to `summary`, `results` maps to `runs`. */
export const COLLECT_TAB_ALIASES: Readonly<Record<string, CollectTab>> = {
    overview: 'summary',
    results: 'runs',
};

/** One row of the frozen Spur run-list envelope (`/api/runs`). */
export interface RunListRow {
    id: string;
    workflowName: string;
    status: string;
    startedAt?: string | null;
    /** Spur's own completion stamp; absent/null while the run is still running. */
    completedAt?: string | null;
}

/** The paged envelope `/api/runs` answers with (§9 frozen list shape). */
export interface RunListPage {
    runs: RunListRow[];
    count: number;
    nextCursor: string | null;
    hasMore: boolean;
}

/**
 * The resolved selection: which run, which tab. `runId: null` is the explicit no-run state.
 * Generic over the tab-id set so Collect's five tabs type-check without widening `BoardTab`.
 */
export interface RunSelection<T extends string = BoardTab> {
    runId: string | null;
    tab: T;
}

/** The parsed `?run=&tab=` query, with a diagnostic for every rejected part. */
export interface DeepLink<T extends string = BoardTab> {
    runId?: string;
    tab?: T;
    diagnostics: BoardDiagnostic[];
}

/** True when `value` is one of the four shipped tabs. */
export function isBoardTab(value: string | null | undefined): value is BoardTab {
    return value !== null && value !== undefined && (BOARD_TABS as readonly string[]).includes(value);
}

/**
 * Parse the `?run=&tab=` query. An unknown tab or a blank run id is dropped with a
 * diagnostic — never silently rewritten into a different selection.
 *
 * `tabs` is the module's own tab set and `aliases` maps superseded ids onto current ones; both
 * default to the shipped behaviour, so Daily Voice and ITC call this unchanged.
 */
export function parseDeepLink<T extends string = BoardTab>(
    search: string,
    tabs: readonly T[] = BOARD_TABS as unknown as readonly T[],
    aliases: Readonly<Record<string, T>> = {},
): DeepLink<T> {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const diagnostics: BoardDiagnostic[] = [];
    const rawTab = params.get('tab');
    const rawRun = params.get('run');
    const known: readonly string[] = tabs;
    let tab: T | undefined;
    if (rawTab !== null) {
        // An alias only resolves to a tab this module actually has: an alias for a tab set
        // without it is a diagnostic, not a selection.
        const aliased = Object.hasOwn(aliases, rawTab) ? aliases[rawTab] : undefined;
        if (known.includes(rawTab)) {
            tab = rawTab as T;
        } else if (aliased !== undefined && known.includes(aliased)) {
            tab = aliased;
        } else {
            diagnostics.push({
                code: 'board.deeplink.unknown-tab',
                message: `Unknown tab '${rawTab}'; showing the default tab.`,
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
export function resolveSelection<T extends string = BoardTab>(
    rows: readonly RunListRow[],
    link: DeepLink<T>,
    // `summary` names a tab in every tab set this module family has (shipped four, Collect's five).
    defaultTab: T = 'summary' as T,
): RunSelection<T> & { diagnostics: BoardDiagnostic[] } {
    const tab = link.tab ?? defaultTab;
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
export function selectionQuery(selection: RunSelection<string>, search = ''): string {
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

/** The Collect module page route (`/board/modules/<id>`); its assets use the bare `/modules/<id>` prefix. */
export const COLLECT_MODULE_PATH = '/board/modules/kk-collect';

/**
 * The address-bar target the selection deep-links to: a module route plus its query. `modulePath`
 * defaults to the Collect route; the daily-voice/itc entries pass their own host route.
 */
export function selectionPath(selection: RunSelection<string>, search = '', modulePath = COLLECT_MODULE_PATH): string {
    return `${modulePath}${selectionQuery(selection, search)}`;
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
export function syncSelectionUrl(
    selection: RunSelection<string>,
    target: SelectionUrlTarget,
    modulePath = COLLECT_MODULE_PATH,
): void {
    // Never fight the host router: only write while this module owns the address bar.
    if (target.location.pathname !== modulePath) return;
    const url = selectionPath(selection, target.location.search, modulePath);
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
