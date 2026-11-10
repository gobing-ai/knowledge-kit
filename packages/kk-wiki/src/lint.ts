import type { FindingRecord } from './findings';
import { resolveLink, type VaultIndex } from './graph';

/**
 * Vault health check (task 0351, docs/design/kk-wiki.md §3).
 *
 * Pure: everything it needs comes from the index. Findings are data; the CLI renders them.
 */

/** Files exempt from the orphan rule: the vault entry points carry no inbound link by design. */
const ORPHAN_EXEMPT_FILES = new Set(['index.md', 'MAP.md']);

/** Report broken links, orphan pages and frontmatter defects over an index. */
export function lintPages(index: VaultIndex): FindingRecord[] {
    const findings: FindingRecord[] = [...index.findings];
    for (const page of index.pages) {
        for (const link of page.links) {
            if (resolveLink(index, link) !== undefined) continue;
            findings.push({
                code: 'broken-link',
                path: page.path,
                line: link.line,
                message: `[[${link.target}]] resolves to no page`,
            });
        }
        const basename = page.path.split('/').pop() ?? page.path;
        if (page.inbound === 0 && !ORPHAN_EXEMPT_FILES.has(basename)) {
            findings.push({
                code: 'orphan',
                path: page.path,
                line: 1,
                message: 'no page links here',
            });
        }
    }
    return findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.code.localeCompare(b.code));
}

/** Exit code contract: findings are a failure, an empty vault is not. */
export function lintExitCode(findings: FindingRecord[]): 0 | 1 {
    return findings.length === 0 ? 0 : 1;
}
