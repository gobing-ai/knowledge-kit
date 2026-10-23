import { join } from 'node:path';
import type {
    BoardDiagnostic,
    CollectChannelYield,
    CollectRunStore,
    CollectRunStoreRow,
    CollectStoreItem,
    CollectStoreItems,
    CollectStoreOverview,
    CollectStoreSelections,
    StoreChannelsQuery,
} from '@gobing-ai/kk-board/contracts';
import {
    type CollectViewItem,
    type CollectViewItemsFilter,
    type CollectViewLabelQuality,
    type CollectViewRunRow,
    DEFAULT_STORE_DB_PATH,
    type LabelPolicy,
    openStore,
    readStoreConfig,
    type Store,
} from '@gobing-ai/kk-store';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { resolveKkConfigPath } from '../invoke';

/**
 * The Collect store views (G81, task 0307 — docs/design/collect-store-views.md §3).
 *
 * Reads `<projectPath>/.works/kk.db` through `Store.collectView` and maps the aggregate rows into
 * the Board contracts. READ-ONLY by construction: the file is `stat`-ed first (a missing path is
 * never opened, because `openStore` would create it), it is opened with `migrate: false` (no DDL,
 * no journal write, no upgrade) and closed in `finally`. An unavailable store degrades only these
 * projections — empty shapes plus a diagnostic, never a `0` that reads as a stored fact.
 */

/** Where the reader reads from: the project that owns `.works/kk.db`, and its injectable seams. */
export interface CollectStoreDeps {
    /** Canonical project root. */
    projectPath: string;
    fs?: FileSystem;
    /** kk operator config path; defaults to `resolveKkConfigPath()`. */
    configPath?: string;
}

/** The `…/store/items` query, already syntactically validated by the reader. */
export interface CollectStoreItemsQuery {
    page: number;
    source?: string;
    seen?: 'new' | 'reseen';
    decision?: string;
    value?: string;
    selection?: 'selected' | 'published' | 'dropped' | 'none';
    search?: string;
}

/** The `…/store/selections` query. */
export interface CollectStoreSelectionsQuery {
    page: number;
    runId?: string;
    topic?: string;
    status?: 'selected' | 'published' | 'dropped';
    search?: string;
}

/** A title longer than this is truncated: the store's titles are untrusted text (design §3). */
export const ITEM_TITLE_MAX = 300;

/** Bounded, path-free diagnostics for every failure mode (design §3 availability). */
const MISSING: BoardDiagnostic = {
    code: 'board.store.missing',
    message: 'This project has no kk store at .works/kk.db.',
};
const UNREADABLE: BoardDiagnostic = {
    code: 'board.store.unreadable',
    message: 'The kk store could not be read.',
};
const NEWER: BoardDiagnostic = {
    code: 'board.store.newer',
    message: 'The kk store was written by a newer kk; upgrade kk to read it.',
};
const POLICY: BoardDiagnostic = {
    code: 'board.store.policy',
    message: 'The label policy is unreadable; effective labels are omitted.',
};
const SOURCE_COUNTS: BoardDiagnostic = {
    code: 'board.store.row-invalid',
    message: 'A stored run row carries source counts that are not valid JSON.',
};

/** The three named ingest plugins the plugin table always shows, plus observed keys (0319). */
const NAMED_PLUGINS = ['aihot-ingest', 'horizon-ingest', 'last30days-ingest'] as const;

/** Days per aggregate page for the channels route (design: 30). */
export const CHANNELS_PAGE_SIZE = 30;

/** One bounded diagnostic for malformed plugin counts on a channels day. */
const CHANNEL_INVALID: BoardDiagnostic = {
    code: 'board.store.channel-invalid',
    message: 'A stored run row carries plugin counts that are not nonnegative integers.',
};

/** One opened store plus the label policy its effective-label reads use. */
interface StoreSession {
    store: Store;
    policy: LabelPolicy | null;
    diagnostics: BoardDiagnostic[];
}

type SessionResult = { ok: true; session: StoreSession } | { ok: false; diagnostics: BoardDiagnostic[] };

/**
 * Open the project's store read-only: absent → no open at all; busy/corrupt → `unreadable`; a
 * journal id this build does not know → `newer` (the guard `migrate: false` deliberately skips).
 * A policy read failure never refuses the store — it only empties `effective`.
 */
async function sessionFor(deps: CollectStoreDeps): Promise<SessionResult> {
    const fs = deps.fs ?? createNodeFileSystem();
    const dbPath = join(deps.projectPath, DEFAULT_STORE_DB_PATH);
    const stat = await fs.stat(dbPath);
    if (stat === null || !stat.isFile()) return { ok: false, diagnostics: [MISSING] };
    let store: Store;
    try {
        store = await openStore({ path: dbPath, migrate: false });
    } catch {
        return { ok: false, diagnostics: [UNREADABLE] };
    }
    try {
        const unknown = await store.collectView.unknownMigrationIds();
        if (unknown.length > 0) {
            await store.close();
            return { ok: false, diagnostics: [NEWER] };
        }
    } catch {
        await store.close();
        return { ok: false, diagnostics: [UNREADABLE] };
    }
    const diagnostics: BoardDiagnostic[] = [];
    let policy: LabelPolicy | null = null;
    try {
        policy = (await readStoreConfig(deps.configPath ?? resolveKkConfigPath())).labels;
    } catch {
        diagnostics.push(POLICY);
    }
    return { ok: true, session: { store, policy, diagnostics } };
}

/** `collect_runs.source_counts_json` → the contract's map; invalid JSON is `{}` plus a diagnostic. */
function sourceCountsOf(raw: string, diagnostics: BoardDiagnostic[]): Record<string, number> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        if (!diagnostics.includes(SOURCE_COUNTS)) diagnostics.push(SOURCE_COUNTS);
        return {};
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        if (!diagnostics.includes(SOURCE_COUNTS)) diagnostics.push(SOURCE_COUNTS);
        return {};
    }
    const counts: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'number' && Number.isFinite(value)) counts[key] = value;
    }
    return counts;
}

/** One stored row in the contract shape (the DAO keeps the JSON text so the parse is diagnosed). */
function runRowOf(row: CollectViewRunRow, diagnostics: BoardDiagnostic[]): CollectRunStoreRow {
    return {
        runId: row.runId,
        sourceCounts: sourceCountsOf(row.sourceCountsJson, diagnostics),
        inserted: row.inserted,
        updated: row.updated,
        labelRows: row.labelRows,
        labeledItems: row.labeledItems,
        labelRowsBySource: row.labelRowsBySource,
        yield: row.yield,
    };
}

/** `GET /api/workflows/kk-collect/store/overview?runs=…` — no Spur call, ids only select rows. */
export async function storeOverview(deps: CollectStoreDeps, runIds: readonly string[]): Promise<CollectStoreOverview> {
    const session = await sessionFor(deps);
    if (!session.ok) {
        return {
            schemaVersion: 1,
            availability: 'unavailable',
            lastStoredAt: null,
            rows: Object.fromEntries(runIds.map((runId) => [runId, null])),
            diagnostics: session.diagnostics,
        };
    }
    const { store, diagnostics } = session.session;
    try {
        const [rows, lastStoredAt] = await Promise.all([
            store.collectView.runRows(runIds),
            store.collectView.lastStoredAt(),
        ]);
        const byId = new Map(rows.map((row) => [row.runId, runRowOf(row, diagnostics)]));
        return {
            schemaVersion: 1,
            availability: 'available',
            lastStoredAt,
            rows: Object.fromEntries(runIds.map((runId) => [runId, byId.get(runId) ?? null])),
            diagnostics,
        };
    } catch {
        return {
            schemaVersion: 1,
            availability: 'unavailable',
            lastStoredAt: null,
            rows: Object.fromEntries(runIds.map((runId) => [runId, null])),
            diagnostics: [...diagnostics, UNREADABLE],
        };
    } finally {
        await store.close();
    }
}

/** One label-quality row in the contract shape: the run's own histogram plus the effective one. */
function labelQualityOf(
    run: CollectViewLabelQuality[],
    effective: Map<string, Map<string, number>>,
): CollectRunStore['labelQuality'] {
    const decisionIds = new Set([...run.map((entry) => entry.decisionId), ...effective.keys()]);
    return [...decisionIds].sort().map((decisionId) => ({
        decisionId,
        run: run.find((entry) => entry.decisionId === decisionId)?.run ?? [],
        effective: [...(effective.get(decisionId) ?? new Map<string, number>())]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([value, count]) => ({ value, count })),
    }));
}

/** `GET /api/workflows/kk-collect/runs/<id>/store` — the run's stored row and label quality. */
export async function storeRun(deps: CollectStoreDeps, runId: string): Promise<CollectRunStore> {
    const session = await sessionFor(deps);
    if (!session.ok) {
        return {
            schemaVersion: 1,
            availability: 'unavailable',
            runId,
            row: null,
            labelQuality: [],
            diagnostics: session.diagnostics,
        };
    }
    const { store, policy, diagnostics } = session.session;
    try {
        const rows = await store.collectView.runRows([runId]);
        const labelQuality = await store.collectView.labelQuality(runId);
        const effective = new Map<string, Map<string, number>>();
        if (policy !== null) {
            const itemIds = await store.collectView.labeledItemIds(runId);
            for (const label of await store.labels.currentFor(itemIds, policy)) {
                const values = effective.get(label.decisionId) ?? new Map<string, number>();
                values.set(label.value, (values.get(label.value) ?? 0) + 1);
                effective.set(label.decisionId, values);
            }
        }
        const found = rows[0];
        return {
            schemaVersion: 1,
            availability: 'available',
            runId,
            row: found === undefined ? null : runRowOf(found, diagnostics),
            labelQuality: labelQualityOf(labelQuality, effective),
            diagnostics,
        };
    } catch {
        return {
            schemaVersion: 1,
            availability: 'unavailable',
            runId,
            row: null,
            labelQuality: [],
            diagnostics: [...diagnostics, UNREADABLE],
        };
    } finally {
        await store.close();
    }
}

/** `canonical_url` is a link only when it is http(s): anything else renders as text, not a target. */
function linkOf(canonicalUrl: string | null): string | null {
    if (canonicalUrl === null) return null;
    return /^https?:\/\//i.test(canonicalUrl) ? canonicalUrl : null;
}

/** One item in the contract shape: title capped, URL http(s)-only, text otherwise untouched. */
function itemOf(item: CollectViewItem): CollectStoreItem {
    return {
        id: item.id,
        title: item.title.slice(0, ITEM_TITLE_MAX),
        url: linkOf(item.canonicalUrl),
        source: item.source,
        storyId: item.storyId,
        seen: item.seen,
        labels: item.labels,
        labelDetails: item.labelDetails,
        selection: item.selection,
        domain: item.domain,
        lang: item.lang,
        bodyChars: item.bodyChars,
        engagement: item.engagement,
        firstSeenAt: item.firstSeenAt,
        publishedAt: item.publishedAt,
    };
}

/**
 * `GET /api/workflows/kk-collect/runs/<id>/store/items` — one page of the run's items.
 *
 * @returns `null` when `source` is not one of the store's own values (the reader answers 400).
 */
export async function storeItems(
    deps: CollectStoreDeps,
    runId: string | null | undefined,
    query: CollectStoreItemsQuery,
): Promise<CollectStoreItems | null> {
    const session = await sessionFor(deps);
    const resolvedRunId = runId ?? '';
    if (!session.ok) {
        return {
            schemaVersion: 1,
            availability: 'unavailable',
            runId: resolvedRunId,
            page: query.page,
            pageSize: 25,
            total: 0,
            items: [],
            sources: [],
            diagnostics: session.diagnostics,
        };
    }
    const { store, policy, diagnostics } = session.session;
    try {
        const sources = await store.collectView.itemSources();
        // A source outside the store's own values is a bad request, not an empty page.
        if (query.source !== undefined && !sources.includes(query.source)) return null;
        const filter: CollectViewItemsFilter = {
            ...(query.source === undefined ? {} : { source: query.source }),
            ...(query.seen === undefined ? {} : { seen: query.seen }),
            ...(query.decision === undefined ? {} : { decision: query.decision }),
            ...(query.value === undefined ? {} : { value: query.value }),
            ...(query.selection === undefined ? {} : { selection: query.selection }),
            ...(query.search === undefined ? {} : { search: query.search }),
        };
        // No policy (unreadable) fails closed: `labels_current` is empty, so a decision/value
        // filter matches nothing and every `effective` list stays empty. Never a guessed policy.
        const effectivePolicy = policy ?? { priority: [], decisionPriority: {}, minConfidence: 1 };
        const page = await store.collectView.itemsPage(runId, filter, query.page, effectivePolicy);
        return {
            schemaVersion: 1,
            availability: 'available',
            runId: resolvedRunId,
            page: query.page,
            pageSize: 25,
            total: page.total,
            items: page.items.map(itemOf),
            sources,
            diagnostics,
        };
    } catch {
        return {
            ...emptyItems(resolvedRunId, query, []),
            availability: 'unavailable',
            diagnostics: [...diagnostics, UNREADABLE],
        };
    } finally {
        await store.close();
    }
}

/**
 * `GET /api/workflows/kk-collect/store/selections` — one page of selections.
 */
export async function storeSelections(
    deps: CollectStoreDeps,
    query: CollectStoreSelectionsQuery,
): Promise<CollectStoreSelections> {
    const session = await sessionFor(deps);
    if (!session.ok) {
        return {
            schemaVersion: 1,
            availability: 'unavailable',
            page: query.page,
            pageSize: 25,
            total: 0,
            selections: [],
            topics: [],
            diagnostics: session.diagnostics,
        };
    }
    const { store, diagnostics } = session.session;
    try {
        const page = await store.collectView.selectionsPage(
            {
                runId: query.runId,
                topic: query.topic,
                status: query.status,
                search: query.search,
            },
            query.page,
        );
        return {
            schemaVersion: 1,
            availability: 'available',
            page: query.page,
            pageSize: 25,
            total: page.total,
            topics: page.topics,
            selections: page.selections.map((s) => ({
                topic: s.topic,
                itemId: s.itemId,
                runId: s.runId,
                storyId: s.storyId,
                workflow: s.workflow,
                rank: s.rank,
                reason: s.reason,
                status: s.status,
                selectedAt: s.selectedAt,
                publishedAt: s.publishedAt,
                title: s.title ? s.title.slice(0, ITEM_TITLE_MAX) : null,
                source: s.source,
                url: linkOf(s.canonicalUrl),
            })),
            diagnostics,
        };
    } catch {
        return {
            schemaVersion: 1,
            availability: 'unavailable',
            page: query.page,
            pageSize: 25,
            total: 0,
            selections: [],
            topics: [],
            diagnostics: [...diagnostics, UNREADABLE],
        };
    } finally {
        await store.close();
    }
}

/** The empty `…/store/items` shape: no rows, never a fabricated count. */
function emptyItems(runId: string, query: CollectStoreItemsQuery, sources: string[]): CollectStoreItems {
    return {
        schemaVersion: 1,
        availability: 'unavailable',
        runId,
        page: query.page,
        pageSize: 25,
        total: 0,
        items: [],
        sources,
        diagnostics: [],
    };
}

/** The reader host's IANA time zone, consistent with SQLite's `localtime` day grouping. */
function hostTimeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The empty `…/store/channels` shape: no fabricated zero, just the unavailable envelope. */
function emptyChannels(query: StoreChannelsQuery, diagnostics: BoardDiagnostic[]): CollectChannelYield {
    return {
        schemaVersion: 1,
        availability: 'unavailable',
        fromMs: query.fromMs,
        untilMs: query.untilMs,
        timeZone: hostTimeZone(),
        page: query.page,
        pageSize: CHANNELS_PAGE_SIZE,
        totalDays: 0,
        sources: [],
        plugins: [],
        byDay: [],
        bySource: {},
        runsByDay: [],
        lastPositiveAt: {},
        diagnostics,
    };
}

/**
 * `GET /api/workflows/kk-collect/store/channels` — one read-only aggregate serving BOTH tables:
 * new-item yield (day × source) and tick/plugin counts (day × plugin), each bounded to 30 days.
 *
 * `bySource` and `totalDays` cover the whole `[fromMs, untilMs)` interval; only `byDay`/`runsByDay`
 * are paged. A day known to one table but not the other is zero-filled on the missing side. A
 * malformed `source_counts_json` day keeps its tick count but its plugin totals are `null` plus a
 * bounded diagnostic. `lastPositiveAt` spans retained history, so a quiet plugin is still named.
 */
export async function storeChannels(deps: CollectStoreDeps, query: StoreChannelsQuery): Promise<CollectChannelYield> {
    const session = await sessionFor(deps);
    if (!session.ok) return emptyChannels(query, session.diagnostics);
    const { store, diagnostics } = session.session;
    try {
        const [itemDays, runYield] = await Promise.all([
            store.collectView.channelYield(query.fromMs, query.untilMs),
            store.collectView.channelRunYield(query.fromMs, query.untilMs),
        ]);

        const sources = [...new Set(itemDays.map((row) => row.source))].sort();
        const bySource: Record<string, number> = {};
        const itemByDay = new Map<string, { total: number; sources: Record<string, number> }>();
        for (const row of itemDays) {
            const entry = itemByDay.get(row.day) ?? { total: 0, sources: {} };
            entry.total += row.items;
            entry.sources[row.source] = (entry.sources[row.source] ?? 0) + row.items;
            itemByDay.set(row.day, entry);
            bySource[row.source] = (bySource[row.source] ?? 0) + row.items;
        }

        const runByDay = new Map(runYield.days.map((day) => [day.day, day]));
        const observedPlugins = new Set<string>();
        for (const day of runYield.days) {
            if (day.plugins !== null) for (const plugin of Object.keys(day.plugins)) observedPlugins.add(plugin);
        }
        for (const plugin of Object.keys(runYield.lastPositiveAt)) observedPlugins.add(plugin);
        const plugins = [...new Set([...NAMED_PLUGINS, ...observedPlugins])].sort();

        // The union of item/tick local-day keys, newest first. No synthetic empty calendar days.
        const days = [...new Set([...itemByDay.keys(), ...runByDay.keys()])].sort().reverse();
        const totalDays = days.length;
        const offset = (Math.max(1, query.page) - 1) * CHANNELS_PAGE_SIZE;
        const pageDays = days.slice(offset, offset + CHANNELS_PAGE_SIZE);

        const byDay = pageDays.map((day) => {
            const item = itemByDay.get(day);
            const sourcesOfDay: Record<string, number> = {};
            for (const source of sources) sourcesOfDay[source] = item?.sources[source] ?? 0;
            return { day, total: item?.total ?? 0, sources: sourcesOfDay };
        });

        const runsByDay = pageDays.map((day) => {
            const run = runByDay.get(day);
            const pluginsOfDay =
                run?.plugins === null
                    ? null
                    : Object.fromEntries(plugins.map((plugin) => [plugin, run?.plugins?.[plugin] ?? 0]));
            return { day, runs: run?.runs ?? 0, plugins: pluginsOfDay };
        });

        const lastPositiveAt: Record<string, number | null> = {};
        for (const plugin of plugins) lastPositiveAt[plugin] = runYield.lastPositiveAt[plugin] ?? null;

        const channelDiagnostics = [...diagnostics];
        if (runYield.days.some((day) => day.plugins === null)) channelDiagnostics.push(CHANNEL_INVALID);

        return {
            schemaVersion: 1,
            availability: 'available',
            fromMs: query.fromMs,
            untilMs: query.untilMs,
            timeZone: hostTimeZone(),
            page: query.page,
            pageSize: CHANNELS_PAGE_SIZE,
            totalDays,
            sources,
            plugins,
            byDay,
            bySource,
            runsByDay,
            lastPositiveAt,
            diagnostics: channelDiagnostics,
        };
    } catch {
        return emptyChannels(query, [...diagnostics, UNREADABLE]);
    } finally {
        await store.close();
    }
}
