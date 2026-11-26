import type { DailyDigest, DaySummary } from '@gobing-ai/kk-board/contracts';

/**
 * The digest renderers (G83, task 0439 — docs/design/daily-voice-ops-console.md §3).
 *
 * Presentation only: every figure comes from the projection, an unknown renders as the word
 * `unknown` with its reason, and a recipe renders as a copyable command. Nothing is recomputed here,
 * so `kk news digest` and the Board's Today tab cannot drift.
 */

/** The severity mark an attention row carries in markdown. */
const SEVERITY_MARK: Record<string, string> = { error: '✗', warn: '!', info: '·' };

function orUnknown(value: string | null, reason: string | null): string {
    if (value !== null) return value;
    return reason === null ? 'unknown' : `unknown (${reason})`;
}

/** One generated command line, rendered as fenced text so it is copyable and never a link. */
function recipeLine(argv: readonly string[]): string {
    return `    \`${argv.join(' ')}\``;
}

/**
 * Render one day's digest as operator-facing markdown.
 *
 * The header carries status and the attention count; an empty attention list prints an explicit
 * all-clear rather than nothing, so a quiet day cannot read as a missing section.
 */
export function renderDigestMarkdown(digest: DailyDigest): string {
    const lines: string[] = [];
    lines.push(`# Daily AI Voice — ${digest.day}`, '');
    lines.push(`Status: **${digest.status}** · attention: ${digest.attention.length}`, '');

    const generation = digest.generation;
    lines.push('## Generation', '');
    lines.push(`- run: ${orUnknown(generation.runId, generation.unknownReason)}`);
    lines.push(`- launch: ${orUnknown(generation.launchStatus, generation.unknownReason)}`);
    lines.push(`- outcome: ${orUnknown(generation.outcome, generation.unknownReason)}`);
    lines.push(`- duration: ${generation.startedAt ?? 'unknown'} → ${generation.finishedAt ?? 'unknown'}`);
    const bundle = generation.bundle;
    lines.push(
        bundle === null
            ? '- bundle: unknown'
            : `- bundle: ${bundle.identity} · ${bundle.title ?? 'untitled'} · safety ${bundle.safety ?? 'unknown'}`,
    );
    if (generation.attempts.length > 1) {
        lines.push(`- attempts: ${generation.attempts.map((attempt) => attempt.runId).join(', ')}`);
    }
    if (generation.durations.length > 0) {
        lines.push('- steps:');
        for (const duration of generation.durations) {
            const seconds = duration.durationMs === null ? 'unknown' : `${Math.round(duration.durationMs / 1000)}s`;
            lines.push(`    - ${duration.step}: ${seconds}`);
        }
    }
    lines.push('');

    lines.push('## Publishing', '');
    if (digest.windows.length === 0) lines.push('- no publish windows recorded');
    for (const window of digest.windows) {
        lines.push(
            `- **${window.window}**: ${window.launchStatus}${window.unknownReason === null ? '' : ` (${window.unknownReason})`} · outcome ${window.recordedStatus ?? 'unknown'}`,
        );
        for (const target of window.targets) {
            const effect = target.effect === null ? '' : ` effect ${target.effect}`;
            const error = target.error === null ? '' : ` — ${target.error}`;
            lines.push(`    - ${target.id}: ${target.status}${effect}${error}`);
        }
    }
    lines.push('');

    lines.push('## Safety', '');
    lines.push(
        `- verdict: ${orUnknown(digest.safety.verdict, digest.safety.unknownReason)} · judge: ${digest.safety.judge ?? 'unknown'}`,
        '',
    );

    lines.push('## Attention', '');
    if (digest.attention.length === 0) {
        lines.push('- all clear — nothing needs the operator', '');
    } else {
        for (const item of digest.attention) {
            lines.push(`- ${SEVERITY_MARK[item.severity] ?? '·'} **${item.kind}** (${item.subject}): ${item.message}`);
            if (item.evidence !== null) lines.push(`    evidence: \`${item.evidence}\``);
            for (const recipe of item.recipes) {
                lines.push(recipeLine(recipe.argv));
                if (recipe.dryRunArgv !== undefined) lines.push(`    dry run: \`${recipe.dryRunArgv.join(' ')}\``);
            }
            if (item.recipes.length === 0) lines.push('    no recipe — the evidence above names what is missing');
        }
        lines.push('');
    }

    if (digest.diagnostics.length > 0) {
        lines.push('## Diagnostics', '');
        for (const diagnostic of digest.diagnostics) lines.push(`- \`${diagnostic.code}\`: ${diagnostic.message}`);
        lines.push('');
    }
    return lines.join('\n');
}

/** Render the History list: one row per day, newest first (the order `listDays` returns). */
export function renderDaysMarkdown(days: readonly DaySummary[]): string {
    if (days.length === 0) return 'No recorded day in the selected range.\n';
    const lines = ['| Day | Status | Run | Windows |', '| --- | --- | --- | --- |'];
    for (const day of days) {
        const windows = day.windows.map((window) => `${window.window}: ${window.launchStatus}`).join(', ');
        lines.push(`| ${day.day} | ${day.status} | ${day.runId ?? 'unknown'} | ${windows || 'none'} |`);
    }
    return `${lines.join('\n')}\n`;
}
