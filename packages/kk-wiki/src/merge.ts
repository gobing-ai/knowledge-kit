import type { VaultIndex } from './graph';
import { renderPage } from './page';
import { applyWriteToPage } from './write';

/**
 * `merge` mechanics (task 0353): collapse two overlapping pages into one and keep every inbound
 * link working.
 *
 * The absorbed page is never deleted — it becomes a redirect stub, so old Obsidian links and
 * external URLs still resolve.
 */

/** Outcome of one merge. */
export interface MergeResult {
    written: string;
    sourceSlug: string;
    redirects: number;
    guard: 'clean' | 'appended' | 'refused';
    targetText: string;
    sourceText: string;
    rewritten: string[];
    /** Rendered bytes for every page whose inbound link was rewritten (the CLI writes them). */
    rewrittenPages: { path: string; text: string }[];
}

/** Union two page bodies and frontmatter sources, then rewrite every inbound link. */
export function mergePages(index: VaultIndex, from: string, to: string, options: { date: string }): MergeResult {
    const source = index.pages.find((page) => page.path === from || page.slug === from);
    const target = index.pages.find((page) => page.path === to || page.slug === to);
    if (source === undefined) throw new Error(`merge: no source page '${from}'`);
    if (target === undefined) throw new Error(`merge: no target page '${to}'`);
    if (source.frontmatter.user_edited === true) {
        return {
            written: target.path,
            sourceSlug: source.slug,
            redirects: 0,
            guard: 'refused',
            targetText: renderPage(target),
            sourceText: renderPage(source),
            rewritten: [],
            rewrittenPages: [],
        };
    }

    const mergedSources = [...new Set([...target.frontmatter.sources, ...source.frontmatter.sources, source.slug])];
    const unitedBody = `${target.body.replace(/\s+$/, '')}\n\n${source.body.replace(/^\s+/, '')}`;
    const written = applyWriteToPage(
        { ...target, frontmatter: { ...target.frontmatter, sources: mergedSources } },
        unitedBody,
        { mode: 'full', date: options.date },
    );

    // Rewrite inbound links on the other pages (the target itself gains the union body already).
    let redirects = 0;
    const rewritten: string[] = [];
    const rewrittenPages: { path: string; text: string }[] = [];
    for (const page of index.pages) {
        if (page.slug === source.slug || page.slug === target.slug) continue;
        const linked = page.body.replace(
            /\[\[([^\]|]+)(\|[^\]]+)?\]\]/g,
            (whole, rawTarget: string, surface?: string) => {
                const slug = rawTarget
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '');
                if (slug !== source.slug) return whole;
                redirects += 1;
                return surface === undefined ? `[[${target.slug}]]` : `[[${target.slug}${surface}]]`;
            },
        );
        if (linked !== page.body) {
            page.body = linked;
            rewritten.push(page.path);
            rewrittenPages.push({
                path: page.path,
                text: renderPage({
                    ...page,
                    frontmatter: { ...page.frontmatter, updated_at: options.date },
                    body: linked,
                }),
            });
        }
    }

    const sourceText = renderPage({
        ...source,
        frontmatter: {
            ...source.frontmatter,
            updated_at: options.date,
            redirect_to: target.slug,
        },
        body: `Merged into [[${target.slug}|${target.frontmatter.title}]].\n`,
    });
    return {
        written: target.path,
        sourceSlug: source.slug,
        redirects,
        guard: written.guard,
        targetText: written.text,
        sourceText,
        rewritten,
        rewrittenPages,
    };
}
