/**
 * A minimal unified diff (G84, task 0444 — design §10 `edit-artifact` preview).
 *
 * No diff package is installed and this is the only caller, so the algorithm is a prefix/suffix
 * trim around the changed middle: enough to show an operator the line-level change they are about to
 * confirm, without pretending to be a minimal-edit LCS diff. It reports one hunk per call.
 */

/** One side's lines plus whether the text ended with a newline. */
function sided(text: string): { lines: string[]; trailingNewline: boolean } {
    if (text === '') return { lines: [], trailingNewline: false };
    const trailingNewline = text.endsWith('\n');
    const lines = (trailingNewline ? text.slice(0, -1) : text).split('\n');
    return { lines, trailingNewline };
}

/** The number of leading lines `a` and `b` share. */
function commonPrefix(a: readonly string[], b: readonly string[]): number {
    const limit = Math.min(a.length, b.length);
    let index = 0;
    while (index < limit && a[index] === b[index]) index += 1;
    return index;
}

/** The number of trailing lines `a` and `b` share, never overlapping the prefix. */
function commonSuffix(a: readonly string[], b: readonly string[], prefix: number): number {
    const limit = Math.min(a.length, b.length) - prefix;
    let count = 0;
    while (count < limit && a[a.length - 1 - count] === b[b.length - 1 - count]) count += 1;
    return count;
}

/**
 * Render the difference between `before` and `after` as a unified diff against `a/<label>` and
 * `b/<label>`; an unchanged pair renders as the empty string.
 */
export function unifiedDiff(before: string, after: string, aLabel: string, bLabel: string): string {
    if (before === after) return '';
    const a = sided(before);
    const b = sided(after);
    let prefix = commonPrefix(a.lines, b.lines);
    const suffix = commonSuffix(a.lines, b.lines, prefix);
    // Identical lines can still differ in their final newline. A fully shared body would render an
    // empty hunk, so the last line is pulled into both sides and the marker states why.
    if (
        a.lines.length > 0 &&
        a.lines.length === b.lines.length &&
        a.trailingNewline !== b.trailingNewline &&
        prefix + suffix === a.lines.length
    ) {
        prefix = a.lines.length - 1;
    }
    const removed = a.lines.slice(prefix, a.lines.length - suffix);
    const added = b.lines.slice(prefix, b.lines.length - suffix);

    // `@@` counts follow the diff convention: an empty side starts at the line before the hunk.
    const aStart = removed.length === 0 ? prefix : prefix + 1;
    const bStart = added.length === 0 ? prefix : prefix + 1;
    const out: string[] = [
        `--- a/${aLabel}`,
        `+++ b/${bLabel}`,
        `@@ -${aStart},${removed.length} +${bStart},${added.length} @@`,
    ];
    for (const line of removed) out.push(`-${line}`);
    if (removed.length > 0 && !a.trailingNewline) out.push('\\ No newline at end of file');
    for (const line of added) out.push(`+${line}`);
    if (added.length > 0 && !b.trailingNewline) out.push('\\ No newline at end of file');
    return `${out.join('\n')}\n`;
}
