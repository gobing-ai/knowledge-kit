import type { VaultPageEntry } from './graph';

/**
 * `compile` mechanics (task 0353): regenerate `index.md` and `MAP.md` from the page set.
 *
 * A pure function of the pages — the same pages always render the same bytes, so a second
 * consecutive run changes nothing and git diffs stay meaningful.
 */

/** The two compiled files, rendered but not yet written. */
export interface CompiledVault {
    index: string;
    map: string;
}

function oneLineSummary(body: string): string {
    for (const line of body.split('\n')) {
        const text = line.trim();
        if (text === '' || text.startsWith('#') || text.startsWith('---')) continue;
        return text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').slice(0, 120);
    }
    return 'No summary yet.';
}

function groupByType(pages: VaultPageEntry[]): Map<string, VaultPageEntry[]> {
    const groups = new Map<string, VaultPageEntry[]>();
    for (const page of [...pages].sort(
        (a, b) => a.frontmatter.type.localeCompare(b.frontmatter.type) || a.slug.localeCompare(b.slug),
    )) {
        const list = groups.get(page.frontmatter.type) ?? [];
        list.push(page);
        groups.set(page.frontmatter.type, list);
    }
    return groups;
}

/** Render the vault index and map from the page set. */
export function compileIndex(pages: VaultPageEntry[], options: { date: string }): CompiledVault {
    const groups = groupByType(pages);
    const indexLines = ['# Vault index', '', `Compiled ${options.date}. Do not edit by hand; run \`kk wiki compile\`.`];
    for (const [type, entries] of groups) {
        indexLines.push('', `## ${type}`, '');
        for (const page of entries) {
            indexLines.push(`- [[${page.slug}|${page.frontmatter.title}]] — ${oneLineSummary(page.body)}`);
        }
    }
    const mapLines = ['# MAP', '', 'Routing table: page type and tags.', ''];
    for (const [type, entries] of groups) {
        mapLines.push(`## ${type}`, '');
        for (const page of entries) {
            const tags = page.frontmatter.tags.length > 0 ? page.frontmatter.tags.join(', ') : '—';
            mapLines.push(`- ${page.path} → ${page.slug} (tags: ${tags})`);
        }
    }
    return { index: `${indexLines.join('\n')}\n`, map: `${mapLines.join('\n')}\n` };
}

/** Compare a render against what is on disk; callers write only when it differs. */
export function needsWrite(current: string | null, rendered: string): boolean {
    return current !== rendered;
}
