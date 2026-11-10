/** The closed set of vault defect classes (docs/design/kk-wiki.md §3, task 0351). */
export type FindingCode = 'broken-link' | 'orphan' | 'missing-frontmatter' | 'invalid-frontmatter' | 'duplicate-slug';

/** One defect with the page that carries it. */
export interface FindingRecord {
    code: FindingCode;
    path: string;
    /** 1-based line, or 1 when the defect is page-wide. */
    line: number;
    message: string;
}
