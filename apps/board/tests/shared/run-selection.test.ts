import { describe, expect, it } from 'bun:test';
import {
    BOARD_TABS,
    COLLECT_TAB_ALIASES,
    COLLECT_TABS,
    isBoardTab,
    mergeRunPages,
    parseDeepLink,
    resolveSelection,
    selectionPath,
    selectionQuery,
    syncSelectionUrl,
} from '../../src/shared/run-selection';

const rows = [
    { id: 'r-newer', workflowName: 'kk-collect', status: 'done' },
    { id: 'r-older', workflowName: 'kk-collect', status: 'done' },
];

describe('parseDeepLink', () => {
    it('accepts a known run and tab', () => {
        expect(parseDeepLink('?run=r-older&tab=results')).toEqual({
            runId: 'r-older',
            tab: 'results',
            diagnostics: [],
        });
    });

    it('drops an unknown tab with a diagnostic instead of silently rewriting it', () => {
        const link = parseDeepLink('?tab=history');
        expect(link.tab).toBeUndefined();
        expect(link.diagnostics[0]?.code).toBe('board.deeplink.unknown-tab');
    });

    it('drops an empty run id with a diagnostic', () => {
        const link = parseDeepLink('?run=');
        expect(link.runId).toBeUndefined();
        expect(link.diagnostics[0]?.code).toBe('board.deeplink.empty-run');
    });
});

describe('resolveSelection', () => {
    it('keeps the linked run id and tab across a tab change', () => {
        const resolved = resolveSelection(rows, parseDeepLink('?run=r-older&tab=progress'));
        expect(resolved.runId).toBe('r-older');
        expect(resolved.tab).toBe('progress');
        expect(selectionQuery(resolved)).toBe('?run=r-older&tab=progress');
    });

    it('selects the_newest run on a first visit', () => {
        expect(resolveSelection(rows, parseDeepLink('')).runId).toBe('r-newer');
    });

    it('reports an unknown run and stops at the no-run state rather than falling back', () => {
        const resolved = resolveSelection(rows, parseDeepLink('?run=missing'));
        expect(resolved.runId).toBeNull();
        expect(resolved.diagnostics.map((diagnostic) => diagnostic.code)).toContain('board.selection.unknown-run');
    });

    it('has no run when history is empty', () => {
        expect(resolveSelection([], parseDeepLink('')).runId).toBeNull();
    });
});

describe('syncSelectionUrl', () => {
    it('writes the selection into the address bar while preserving the host router state', () => {
        const calls: { data: unknown; url: string }[] = [];
        const history = {
            state: { key: 'router-key', idx: 3 },
            replaceState: (data: unknown, _unused: string, url?: string | null) =>
                calls.push({ data, url: String(url) }),
        };
        const location = { pathname: '/board/modules/kk-collect', search: '?tab=summary' };
        syncSelectionUrl({ runId: 'r-1', tab: 'results' }, { history, location });
        expect(calls).toEqual([
            { data: { key: 'router-key', idx: 3 }, url: '/board/modules/kk-collect?run=r-1&tab=results' },
        ]);
        expect(selectionPath({ runId: 'r-1', tab: 'results' })).toBe('/board/modules/kk-collect?run=r-1&tab=results');
        // Already matching: no write, so the effect can never loop.
        syncSelectionUrl(
            { runId: 'r-1', tab: 'results' },
            { history, location: { pathname: '/board/modules/kk-collect', search: '?run=r-1&tab=results' } },
        );
        expect(calls).toHaveLength(1);
        // The host router has navigated elsewhere: this module must not fight it.
        syncSelectionUrl(
            { runId: 'r-1', tab: 'results' },
            { history, location: { pathname: '/board/settings/workflows', search: '' } },
        );
        expect(calls).toHaveLength(1);
    });

    it('retains a validated kkApi reader origin in the saved URL (§4)', () => {
        const calls: { url: string }[] = [];
        const history = {
            state: null,
            replaceState: (_data: unknown, _unused: string, url?: string | null) => calls.push({ url: String(url) }),
        };
        const kkApi = 'kkApi=http%3A%2F%2F127.0.0.1%3A4341';
        const search = `?run=old&tab=summary&${kkApi}`;
        syncSelectionUrl(
            { runId: 'r-1', tab: 'results' },
            { history, location: { pathname: '/board/modules/kk-collect', search } },
        );
        // The write-back keeps unknown module parameters — dropping kkApi would send a reload back to
        // the default reader port (P3 from the second review).
        expect(calls[0]?.url).toBe(`/board/modules/kk-collect?run=r-1&tab=results&${kkApi}`);
        expect(selectionPath({ runId: 'r-1', tab: 'results' }, search)).toBe(
            `/board/modules/kk-collect?run=r-1&tab=results&${kkApi}`,
        );
    });
});

describe('mergeRunPages', () => {
    it('appends a page without duplicating an already-loaded run', () => {
        const merged = mergeRunPages(rows, {
            runs: [
                { id: 'r-newer', workflowName: 'kk-collect', status: 'done' },
                { id: 'r-oldest', workflowName: 'kk-collect', status: 'failed' },
            ],
            count: 2,
            nextCursor: 'cursor-2',
            hasMore: true,
        });
        expect(merged.runs.map((row) => row.id)).toEqual(['r-newer', 'r-older', 'r-oldest']);
        expect(merged.nextCursor).toBe('cursor-2');
    });
});

describe('tabs', () => {
    it('ships exactly the four tabs', () => {
        expect([...BOARD_TABS]).toEqual(['summary', 'results', 'progress', 'config']);
        expect(isBoardTab('config')).toBe(true);
        expect(isBoardTab('history')).toBe(false);
    });
});

describe('parseDeepLink with a module tab set', () => {
    it('accepts the Collect tabs and resolves the shipped `results` alias', () => {
        expect(parseDeepLink('?run=r-1&tab=items', COLLECT_TABS, COLLECT_TAB_ALIASES)).toEqual({
            runId: 'r-1',
            tab: 'items',
            diagnostics: [],
        });
        expect(parseDeepLink('?tab=results', COLLECT_TABS, COLLECT_TAB_ALIASES).tab).toBe('runs');
        expect(parseDeepLink('?tab=overview', COLLECT_TABS, COLLECT_TAB_ALIASES).tab).toBe('summary');
    });

    it('keeps the shipped defaults: `results` is a tab of its own and Collect ids are unknown', () => {
        expect(parseDeepLink('?tab=results').tab).toBe('results');
        expect(parseDeepLink('?tab=items').tab).toBeUndefined();
        expect(parseDeepLink('?tab=items').diagnostics[0]?.code).toBe('board.deeplink.unknown-tab');
        // No aliases by default: the shipped modules never silently rewrite a tab.
        expect(parseDeepLink('?tab=summary', BOARD_TABS, COLLECT_TAB_ALIASES).tab).toBe('summary');
    });

    it('drops an alias whose target is not in the module tab set', () => {
        const link = parseDeepLink('?tab=history', BOARD_TABS, { history: 'overview' });
        expect(link.tab).toBeUndefined();
        expect(link.diagnostics[0]?.code).toBe('board.deeplink.unknown-tab');
    });

    it('resolves the first visit onto the module default tab', () => {
        expect(resolveSelection(rows, parseDeepLink('', COLLECT_TABS), 'summary')).toEqual({
            runId: 'r-newer',
            tab: 'summary',
            diagnostics: [],
        });
        expect(resolveSelection(rows, parseDeepLink('')).tab).toBe('summary');
    });
});
