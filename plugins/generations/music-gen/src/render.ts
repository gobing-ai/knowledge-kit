import type { StructureEntry } from './brief';
import type { ResolvedJob } from './presets';

/**
 * The kk-owned PROMPT text (task 0397 R2): a deterministic renderer for the
 * instance's PROMPT box only.
 *
 * Segment order is frozen at
 * `technical direction → Avoid: … → timestamped structure lines → instrumental directive`,
 * with each segment on its own line and the `Avoid:` segment omitted when the
 * merged list is empty.
 *
 * kk never renders the duration sentence or the lyrics block: the instance's
 * `assembleLyriaPrompt` appends both server-side and defaults a missing
 * `durationTarget` to `'3:00'`, so rendering them here would duplicate them.
 * The markers are exported so an adapter or test can prove their absence.
 */

/** Exact instrumental directive (R2, em dash deliberate). */
export const INSTRUMENTAL_DIRECTIVE = 'Instrumental only — no vocals.';

/** Exact `Avoid:` segment prefix. */
export const AVOID_PREFIX = 'Avoid: ';

/**
 * Segments the INSTANCE owns. kk output must never contain them; they are
 * markers for assertions, not a render-time rejection — an author's technical
 * direction may legitimately use the words in another sense.
 */
export const INSTANCE_OWNED_PROMPT_MARKERS = ['Total running time', 'Lyrics (sing in'] as const;

/** The four prompt segments, already resolved. */
export interface PromptSegments {
    /** Technical direction: the theme/format/brief style text, first segment. */
    style: string;
    /** Merged deny-list; rendered only when non-empty, in the given order. */
    avoid: readonly string[];
    /** Timestamped structure lines, rendered in the given order. */
    structure: readonly StructureEntry[];
    /** When true, append {@link INSTRUMENTAL_DIRECTIVE}. */
    instrumental: boolean;
}

/** Trim trailing spaces per line and drop leading/trailing blank lines, keeping interior newlines. */
function normalizeBlock(text: string): string {
    return text
        .split('\n')
        .map((line) => line.replace(/\s+$/, ''))
        .join('\n')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '');
}

/** One structure line: `[m:ss] Section` or `[m:ss] Section — note`. */
export function renderStructureLine(entry: StructureEntry): string {
    const head = `[${entry.at}] ${entry.section}`;
    return entry.note === undefined ? head : `${head} — ${entry.note}`;
}

/** Render the kk-owned prompt text. Pure: same input, same bytes, no clock, no IO. */
export function renderPromptText(segments: PromptSegments): string {
    const blocks: string[] = [];
    const direction = normalizeBlock(segments.style);
    if (direction !== '') {
        blocks.push(direction);
    }
    if (segments.avoid.length > 0) {
        blocks.push(`${AVOID_PREFIX}${segments.avoid.join(', ')}`);
    }
    for (const entry of segments.structure) {
        blocks.push(renderStructureLine(entry));
    }
    if (segments.instrumental) {
        blocks.push(INSTRUMENTAL_DIRECTIVE);
    }
    return blocks.join('\n');
}

/** Render the prompt text from a resolved job (the normal call path). */
export function renderBriefPrompt(job: ResolvedJob): string {
    return renderPromptText({
        style: job.style.value,
        avoid: job.avoid.value,
        structure: job.structure.value,
        instrumental: job.instrumental.value,
    });
}
