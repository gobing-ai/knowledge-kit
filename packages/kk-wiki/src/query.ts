import type { VaultIndex, VaultPageEntry } from './graph';

/**
 * `query` mechanics (task 0354): rank pages against a prompt with a frozen, deterministic score.
 *
 * Title 3, tag 2, body 1 per matched term; ties break on slug ascending. No provider call, no
 * embedding index — the answer itself is composed by the skill.
 */

/** One ranked page. */
export interface QueryHit {
    path: string;
    title: string;
    excerpt: string;
    score: number;
}

function terms(prompt: string): string[] {
    return [
        ...new Set(
            prompt
                .toLowerCase()
                .split(/[^a-z0-9]+/)
                .filter((term) => term.length >= 2),
        ),
    ].sort();
}

function scoreOf(page: VaultPageEntry, terms_: string[]): number {
    const title = page.frontmatter.title.toLowerCase();
    const tags = page.frontmatter.tags.join(' ').toLowerCase();
    const body = page.body.toLowerCase();
    let score = 0;
    for (const term of terms_) {
        if (title.includes(term)) score += 3;
        if (tags.includes(term)) score += 2;
        if (body.includes(term)) score += 1;
    }
    return score;
}

function excerptOf(page: VaultPageEntry, terms_: string[]): string {
    for (const line of page.body.split('\n')) {
        const text = line.trim();
        if (text === '' || text.startsWith('#')) continue;
        const lower = text.toLowerCase();
        if (terms_.some((term) => lower.includes(term))) return text.slice(0, 200);
    }
    return page.body.trim().split('\n')[0]?.slice(0, 200) ?? '';
}

/** Rank pages against a prompt. An empty match set is an empty list, never an error. */
export function rankPages(index: VaultIndex, prompt: string, options: { limit?: number } = {}): QueryHit[] {
    const terms_ = terms(prompt);
    const hits: QueryHit[] = [];
    for (const page of index.pages) {
        const score = scoreOf(page, terms_);
        if (score === 0) continue;
        hits.push({ path: page.path, title: page.frontmatter.title, excerpt: excerptOf(page, terms_), score });
    }
    return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, options.limit ?? 10);
}
