import { renderPage, type VaultPage } from './page';

/**
 * The single page-write path (task 0356 minimal form, extended by 0357).
 *
 * Every verb that changes a page body goes through `applyWrite`, so the `user_edited` guard cannot
 * be bypassed by calling a lower-level writer.
 */

/** Guard decision reported to the caller and to the CLI JSON payload. */
export type GuardDecision = 'clean' | 'appended' | 'refused';

/** Write mode: `full` may replace the body, `append` always adds a section. */
export type WriteMode = 'full' | 'append';

/** Result of one guarded write. */
export interface WriteResult {
    body: string;
    guard: GuardDecision;
}

/** Heading a guarded page receives for agent-supplied material. */
export function guardHeading(date: string): string {
    return `## AI Updates (${date})`;
}

/**
 * Append material under the dated guard section: reuse today's section when it exists, otherwise
 * add one below the existing content.
 */
function appendGuarded(body: string, material: string, date: string): string {
    const heading = guardHeading(date);
    const trimmed = material.replace(/\s+$/, '');
    const lines = body.replace(/\s+$/, '').split('\n');
    const headingIndex = lines.findIndex((line) => line.trim() === heading);
    if (headingIndex === -1) return `${lines.join('\n')}\n\n${heading}\n\n${trimmed}\n`;
    const nextHeading = lines.findIndex((line, index) => index > headingIndex && /^##\s+/.test(line));
    const insertAt = nextHeading === -1 ? lines.length : nextHeading;
    const head = lines.slice(0, insertAt);
    while (head.length > 0 && (head[head.length - 1] ?? '').trim() === '') head.pop();
    return `${[...head, '', trimmed].join('\n')}\n${lines.slice(insertAt).join('\n')}`.replace(/\n{3,}/g, '\n\n');
}

/**
 * Apply material to a page under the guard.
 *
 * A page with `user_edited: true` never has its body replaced: the caller's material lands under
 * the dated section and the decision is reported as `appended`.
 */
export function applyWrite(page: VaultPage, material: string, options: { mode: WriteMode; date: string }): WriteResult {
    const guarded = page.frontmatter.user_edited === true;
    if (guarded) return { body: appendGuarded(page.body, material, options.date), guard: 'appended' };
    if (options.mode === 'append') return { body: appendGuarded(page.body, material, options.date), guard: 'clean' };
    return { body: `${material.replace(/\s+$/, '')}\n`, guard: 'clean' };
}

/** Render a page after a guarded write, keeping frontmatter (and bumping `updated_at`). */
export function applyWriteToPage(
    page: VaultPage,
    material: string,
    options: { mode: WriteMode; date: string },
): { text: string; guard: GuardDecision } {
    const result = applyWrite(page, material, options);
    const text = renderPage({
        ...page,
        frontmatter: { ...page.frontmatter, updated_at: options.date },
        body: result.body,
    });
    return { text, guard: result.guard };
}
