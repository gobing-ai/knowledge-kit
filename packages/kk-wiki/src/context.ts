import type { VaultIndex } from './graph';
import { resolveSlug } from './page';

/**
 * `context` mechanics (task 0354): pack a topic page plus its graph neighbours into one Markdown
 * block for an external agent. Each page is introduced by its vault-relative path.
 */

/** The packed block and the paths it contains. */
export interface PackedContext {
    markdown: string;
    pages: string[];
}

/** Pack the topic page and its neighbours (depth 1 by default). */
export function packContext(index: VaultIndex, topic: string, options: { depth?: number } = {}): PackedContext {
    const slug = resolveSlug(topic);
    const topicPage = index.bySlug.get(slug) ?? index.pages.find((page) => page.path === topic);
    if (topicPage === undefined) return { markdown: '', pages: [] };
    const included = [topicPage];
    const neighbours = index.pages.filter(
        (page) =>
            page !== topicPage &&
            (page.links.some((link) => resolveSlug(link.target) === topicPage.slug) ||
                topicPage.links.some((link) => resolveSlug(link.target) === page.slug)),
    );
    for (const page of neighbours.slice(0, Math.max(0, options.depth ?? 1) === 0 ? 0 : neighbours.length)) {
        included.push(page);
    }
    const markdown = included
        .map((page) => `## ${page.path}\n\n${page.body.trim()}\n`)
        .join('\n')
        .trimEnd();
    return { markdown: `${markdown}\n`, pages: included.map((page) => page.path) };
}
