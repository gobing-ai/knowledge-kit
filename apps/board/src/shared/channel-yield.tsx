import type { CollectChannelYield } from '../contracts';

/**
 * The two reusable presentational tables for the Collect Summary channel-yield aggregate (0319).
 *
 * Pure data → markup: the owning module fetches the page and owns degradation/stale-response
 * handling; these components render only what they are given, and never invent a number. An absent
 * value reads `0` only when the server zero-filled a known day (a fact); malformed plugin evidence
 * is `null` and reads `unknown`, never a fabricated zero.
 */

/** A local `YYYY-MM-DD` day key in the reader host's IANA zone (matches SQLite `localtime`). */
function localDayKey(ms: number, timeZone: string): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(ms);
}

/** True when `ms` is exactly local midnight in `timeZone` (a whole-day boundary). */
function isLocalMidnight(ms: number, timeZone: string): boolean {
    return (
        new Intl.DateTimeFormat('en-GB', {
            timeZone,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }).format(ms) === '00:00:00'
    );
}

/** True when `day` is a boundary day of `[fromMs, untilMs)` cut mid-day (honest partial label). */
function isPartialDay(day: string, data: CollectChannelYield): boolean {
    const fromDay = localDayKey(data.fromMs, data.timeZone);
    const untilDay = localDayKey(Math.max(data.fromMs, data.untilMs - 1), data.timeZone);
    if (day === fromDay && !isLocalMidnight(data.fromMs, data.timeZone)) return true;
    if (day === untilDay && !isLocalMidnight(data.untilMs, data.timeZone)) return true;
    return false;
}

/** The operator-facing time for an epoch-ms last-positive stamp (or `unknown`). */
function lastPositiveLabel(at: number | null): string {
    return at === null ? 'unknown' : `${new Date(at).toLocaleString()} (${new Date(at).toISOString()})`;
}

/** New-item yield: one row per local day, one column per observed source, plus row/source totals. */
export function ChannelYieldTable({ data }: { data: CollectChannelYield }) {
    const { sources, byDay, bySource } = data;
    if (byDay.length === 0) {
        return <p className="kk-board-state">No new items in this range.</p>;
    }
    const grandTotal = sources.reduce((sum, source) => sum + (bySource[source] ?? 0), 0);
    return (
        <table className="kk-table kk-channel-yield-table">
            <thead>
                <tr>
                    <th scope="col">Day</th>
                    {sources.map((source) => (
                        <th key={source} scope="col">
                            {source}
                        </th>
                    ))}
                    <th scope="col">Total</th>
                </tr>
            </thead>
            <tbody>
                {byDay.map((day) => (
                    <tr key={day.day}>
                        <td>
                            {day.day}
                            {isPartialDay(day.day, data) ? ' (partial)' : ''}
                        </td>
                        {sources.map((source) => (
                            <td key={source}>{day.sources[source] ?? 0}</td>
                        ))}
                        <td>{day.total}</td>
                    </tr>
                ))}
                <tr className="kk-table-total">
                    <td>Total</td>
                    {sources.map((source) => (
                        <td key={source}>{bySource[source] ?? 0}</td>
                    ))}
                    <td>{grandTotal}</td>
                </tr>
            </tbody>
        </table>
    );
}

/** Per-day `collect_runs` ticks plus summed plugin counts, with last-positive contribution times. */
export function PluginRunTable({ data }: { data: CollectChannelYield }) {
    const { plugins, runsByDay, lastPositiveAt } = data;
    if (runsByDay.length === 0) {
        return <p className="kk-board-state">No collection ticks in this range.</p>;
    }
    return (
        <div className="kk-plugin-run">
            <table className="kk-table kk-plugin-run-table">
                <caption className="kk-plugin-run-caption">
                    Zero recorded contributions — plugin invocation health unknown.
                </caption>
                <thead>
                    <tr>
                        <th scope="col">Day</th>
                        <th scope="col">Runs</th>
                        {plugins.map((plugin) => (
                            <th key={plugin} scope="col">
                                {plugin}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {runsByDay.map((day) => {
                        const pluginCounts = day.plugins;
                        return (
                            <tr key={day.day}>
                                <td>{day.day}</td>
                                <td>{day.runs}</td>
                                {pluginCounts === null ? (
                                    <td colSpan={plugins.length} className="kk-board-state">
                                        unknown
                                    </td>
                                ) : (
                                    plugins.map((plugin) => <td key={plugin}>{pluginCounts[plugin] ?? 0}</td>)
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <dl className="kk-board-facts">
                {plugins.map((plugin) => (
                    <div key={plugin}>
                        <dt>Last positive {plugin}</dt>
                        <dd>{lastPositiveLabel(lastPositiveAt[plugin] ?? null)}</dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}
