import type { VaultIndex } from './graph';
import { linkTitlesInText } from './link';
import { type PageType, renderPage, resolveSlug } from './page';
import { applyWrite, type GuardDecision } from './write';

/**
 * `synthesize` mechanics (task 0357): create a page for a new topic, or extend an existing one.
 *
 * The body text is supplied by the caller (the `kk:wiki-authoring` skill); this module only places
 * it, derives the frontmatter and enforces the guard. Deterministic for identical input.
 */

/** Outcome of one synthesize write. */
export interface SynthesizeResult {
    path: string;
    slug: string;
    guard: GuardDecision;
    created: boolean;
    text: string;
}

/** One synthesize request: the target, the authored text, the page class and the date stamp. */
export interface SynthesizeInput {
    /** Topic title (used for the slug) or an existing page path. */
    target: string;
    material: string;
    /** Page class for a page this call creates; defaults to `concept`. */
    type?: PageType;
    date: string;
}

function folderFor(type: PageType): string {
    if (type === 'entity') return 'entities';
    if (type === 'source') return 'sources';
    return 'concepts';
}

/** Create or extend one page from authored text. */
export function synthesizePage(index: VaultIndex, input: SynthesizeInput): SynthesizeResult {
    const existing =
        index.bySlug.get(resolveSlug(input.target)) ?? index.pages.find((page) => page.path === input.target);
    const linkedText = linkTitlesInText(index, input.material).trim();
    if (existing === undefined) {
        const type = input.type ?? 'concept';
        const slug = resolveSlug(input.target);
        const path = `${folderFor(type)}/${slug}.md`;
        const text = renderPage({
            path,
            frontmatter: {
                title: input.target,
                type,
                tags: [],
                sources: [],
                updated_at: input.date,
            },
            body: `${linkedText}\n`,
        });
        return { path, slug, guard: 'clean', created: true, text };
    }
    const written = applyWrite(existing, linkedText, { mode: 'append', date: input.date });
    return {
        path: existing.path,
        slug: existing.slug,
        guard: written.guard,
        created: false,
        text: renderPage({
            ...existing,
            frontmatter: { ...existing.frontmatter, updated_at: input.date },
            body: written.body,
        }),
    };
}
