import type { VaultIndex, VaultPageEntry } from './graph';
import { linkTitlesInText } from './link';
import { renderPage } from './page';
import { applyWrite, type GuardDecision } from './write';

/**
 * `summarize` mechanics (task 0357): place agent-authored text into a summary section and wire the
 * page references. Deterministic — the caller supplies the text, the CLI never calls a provider.
 */

/** Heading the summary lands under. */
export const SUMMARY_HEADING = '## Summary';

/** Outcome of one summarize write. */
export interface SummarizeResult {
    path: string;
    guard: GuardDecision;
    text: string;
    links: number;
}

/**
 * Replace (or add) the summary section of `target` with `material`, linking every mentioned title.
 *
 * On a guarded page the whole page goes through `applyWrite`, so the summary cannot replace the
 * body the operator edited; it lands under the dated section instead.
 */
export function summarizePage(
    index: VaultIndex,
    target: VaultPageEntry,
    material: string,
    options: { date: string },
): SummarizeResult {
    const linkedText = linkTitlesInText(index, material).trim();
    const lines = target.body.split('\n');
    const headingIndex = lines.findIndex((line) => line.trim() === SUMMARY_HEADING);
    let body: string;
    if (headingIndex === -1) {
        body = `${target.body.replace(/\s+$/, '')}\n\n${SUMMARY_HEADING}\n\n${linkedText}\n`;
    } else {
        const nextHeading = lines.findIndex((line, position) => position > headingIndex && /^##\s+/.test(line));
        const head = lines.slice(0, headingIndex + 1);
        const tail = nextHeading === -1 ? [] : lines.slice(nextHeading);
        body = `${[...head, '', linkedText, '', ...tail]
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trimEnd()}\n`;
    }
    // Unguarded pages take the composed body as-is; a guarded page sends only the new material
    // through the guard, so the operator's bytes above the heading survive.
    const written =
        target.frontmatter.user_edited === true
            ? applyWrite({ ...target, body }, `${SUMMARY_HEADING}\n\n${linkedText}`, {
                  mode: 'full',
                  date: options.date,
              })
            : { body: `${body.replace(/\s+$/, '')}\n`, guard: 'clean' as GuardDecision };
    return {
        path: target.path,
        guard: written.guard,
        text: renderPage({
            ...target,
            frontmatter: { ...target.frontmatter, updated_at: options.date },
            body: written.body,
        }),
        links: (linkedText.match(/\[\[/g) ?? []).length,
    };
}
