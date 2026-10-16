import type { ActionItem, AssessmentRow } from './seo-rules';

export interface AuditArtifact {
    schemaVersion: 1;
    methodVersion: string;
    runId: string;
    revisionId?: string;
    createdAt: string;
    inputDigest: string;
    predecessorDigests: Record<string, string>;
    status: 'complete' | 'partial';
    targetUrl: string;
    scores: {
        technical: number | null;
        content: number | null;
        crawl: number | null;
        security: number | null;
    };
    coverage: {
        totalRules: number;
        applicableRules: number;
        assessed: number;
        unknown: number;
        ratio: number | null;
    };
    facts: Record<string, { value: string | number | boolean | null; unit: string; source: string }>;
    assessments: AssessmentRow[];
    actions: ActionItem[];
    judgments: { status: 'not-assessed' | 'available'; rows?: unknown[] };
    performance: { status: 'not-assessed' | 'available'; rows?: unknown[] };
    visibility: { status: 'not-assessed' | 'available'; rows?: unknown[] };
    limits: unknown;
}

export interface ReportJsonArtifact {
    schemaVersion: 1;
    methodVersion: string;
    runId: string;
    revisionId?: string;
    createdAt: string;
    targetUrl: string;
    status: 'done' | 'partial';
    scores: AuditArtifact['scores'];
    coverage: AuditArtifact['coverage'];
    actionsCount: number;
    actions: ActionItem[];
    narrativeStatus: 'omitted' | 'included' | 'rejected';
}

function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&');
}

/** Render deterministic markdown report from audit data. */
export function renderReportMarkdown(audit: AuditArtifact, narrativeText?: string): string {
    const lines: string[] = [];

    lines.push(`# Smart SEO Audit Report`);
    lines.push(``);
    lines.push(`- **Target URL:** ${audit.targetUrl}`);
    lines.push(`- **Run ID:** \`${audit.runId}\`${audit.revisionId ? ` (Revision: \`${audit.revisionId}\`)` : ''}`);
    lines.push(`- **Status:** **${audit.status.toUpperCase()}**`);
    lines.push(`- **Method Version:** ${audit.methodVersion} (Sources checked at 2026-10-14)`);
    lines.push(``);

    lines.push(`## 1. Category Scores & Coverage`);
    lines.push(``);
    lines.push(`| Category | Score | Metric |`);
    lines.push(`| --- | --- | --- |`);
    lines.push(
        `| Technical | ${audit.scores.technical !== null ? `${audit.scores.technical}/100` : 'N/A (no eligible rules)'} | Pass ratio over applicable assessed checks |`,
    );
    lines.push(
        `| Content | ${audit.scores.content !== null ? `${audit.scores.content}/100` : 'N/A (no eligible rules)'} | Pass ratio over applicable assessed checks |`,
    );
    lines.push(
        `| Crawl | ${audit.scores.crawl !== null ? `${audit.scores.crawl}/100` : 'N/A (no eligible rules)'} | Pass ratio over applicable assessed checks |`,
    );
    lines.push(
        `| Security | ${audit.scores.security !== null ? `${audit.scores.security}/100` : 'N/A (no eligible rules)'} | Pass ratio over applicable assessed checks |`,
    );
    lines.push(``);
    lines.push(`- **Total Checklist Rules:** ${audit.coverage.totalRules}`);
    lines.push(`- **Applicable Rules:** ${audit.coverage.applicableRules}`);
    lines.push(`- **Assessed Checks:** ${audit.coverage.assessed}`);
    lines.push(`- **Unknown / Inconclusive:** ${audit.coverage.unknown}`);
    lines.push(
        `- **Coverage Ratio:** ${audit.coverage.ratio !== null ? `${Math.round(audit.coverage.ratio * 100)}%` : 'N/A'}`,
    );
    lines.push(``);

    lines.push(`## 2. Prioritized Action Items`);
    lines.push(``);
    if (audit.actions.length === 0) {
        lines.push(`No critical or high action items detected.`);
    } else {
        lines.push(`| Priority | ID | Severity | Effort | Affected | Description |`);
        lines.push(`| --- | --- | --- | --- | --- | --- |`);
        for (const act of audit.actions) {
            lines.push(
                `| ${act.priority} | \`${act.id}\` | ${act.severity} | Band ${act.effort} | ${act.affectedPagesCount} | ${escapeMarkdown(act.title)} |`,
            );
        }
    }
    lines.push(``);

    if (narrativeText && narrativeText.trim() !== '') {
        lines.push(`## 3. Executive Narrative`);
        lines.push(``);
        lines.push(narrativeText.trim());
        lines.push(``);
    }

    lines.push(`## 4. Primary Sources & Disclaimers`);
    lines.push(``);
    lines.push(`- RFC 9309 (Robots Exclusion Protocol, 2022) governs robots matching; full Crawl-delay is respected.`);
    lines.push(
        `- Google Search Central canonical guidelines (2026) define canonical hints without proving non-indexing.`,
    );
    lines.push(
        `- Google retired general FAQ rich results in August/September 2023; FAQ schema presence does not guarantee search enhancement.`,
    );
    lines.push(
        `- All crawl-limited findings (e.g. depth, orphan pages) are observations among sampled pages, not whole-web guarantees.`,
    );
    lines.push(``);

    return lines.join('\n');
}
