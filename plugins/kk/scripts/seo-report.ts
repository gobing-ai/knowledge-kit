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
    /** Rejection diagnostics, present only when the narrative was rejected (design §9). */
    narrativeDiagnostics?: string[];
}

/* ------------------------------------------------------------------ *
 * Narrative contract (design §9, refined handoff 2026-10-14)
 *
 * The agent authors references, never prose: it selects an allow-listed
 * heading and a fixed claim template whose evidenceRef points at an
 * immutable audit record. Rendering is method-owned, so a claim can never
 * introduce a measurement, diagnosis or prediction of its own.
 * ------------------------------------------------------------------ */

/** Allow-listed section headings. Unknown headings reject the whole narrative. */
export const NARRATIVE_HEADINGS = ['summary', 'priorities', 'limits'] as const;
export type NarrativeHeading = (typeof NARRATIVE_HEADINGS)[number];

/** Allow-listed claim templates, each bound to one approved audit collection. */
export const NARRATIVE_TEMPLATES = ['fact', 'action', 'limit'] as const;
export type NarrativeTemplate = (typeof NARRATIVE_TEMPLATES)[number];

export interface NarrativeClaim {
    template: NarrativeTemplate;
    evidenceRef: { artifact: 'audit.json'; jsonPointer: string };
}

export interface NarrativeSection {
    heading: NarrativeHeading;
    claims: NarrativeClaim[];
}

export interface NarrativeArtifact {
    schemaVersion: 1;
    runId: string;
    auditDigest: string;
    sections: NarrativeSection[];
}

export interface NarrativeValidation {
    status: 'included' | 'rejected';
    sections: NarrativeSection[];
    diagnostics: string[];
}

/** Bounded narrative envelope (design §9): 32 KiB of JSON, at most 30 claims. */
export const NARRATIVE_MAX_BYTES = 32 * 1024;
export const NARRATIVE_MAX_CLAIMS = 30;

/** Prototype-traversal keys refused at any JSON-pointer segment. */
const FORBIDDEN_POINTER_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Method-owned unit labels for the recorded limit collection. */
const LIMIT_UNITS: Record<string, string> = {
    pagesVisited: 'pages',
    requestsMade: 'requests',
    totalBytes: 'bytes',
    elapsedSeconds: 'seconds',
    hitLimit: '',
};

/** Template → approved target collection. A pointer into any other collection is rejected. */
const TEMPLATE_COLLECTIONS: Record<NarrativeTemplate, string> = {
    fact: 'facts',
    action: 'actions',
    limit: 'limits',
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Exact-key check: every required key present, and no unknown key tolerated. */
function exactKeys(value: Record<string, unknown>, required: readonly string[]): string | null {
    for (const key of required) {
        if (!Object.hasOwn(value, key)) return `missing key "${key}"`;
    }
    for (const key of Object.keys(value)) {
        if (!required.includes(key)) return `unknown key "${key}"`;
    }
    return null;
}

/**
 * Decode a JSON pointer into segments, refusing empty segments, malformed escapes
 * and prototype keys. Returns the failure message, or the decoded segments.
 */
function decodePointer(pointer: string): { segments: string[] } | { error: string } {
    if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
        return { error: `jsonPointer "${String(pointer)}" must be a non-empty JSON pointer starting with "/"` };
    }
    const segments = pointer
        .slice(1)
        .split('/')
        .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
    for (const segment of segments) {
        if (segment === '') return { error: `jsonPointer "${pointer}" has an empty segment` };
        if (FORBIDDEN_POINTER_KEYS.has(segment)) {
            return { error: `jsonPointer "${pointer}" references forbidden key "${segment}"` };
        }
        if (segment.includes('\u0000')) return { error: `jsonPointer "${pointer}" contains a NUL character` };
    }
    return { segments };
}

/**
 * Resolve one claim against the audit, enforcing both the pointer target type and
 * the approved collection for the declared template. Returns null when valid.
 */
function resolveClaim(audit: AuditArtifact, template: NarrativeTemplate, pointer: string): string | null {
    const decoded = decodePointer(pointer);
    if ('error' in decoded) return decoded.error;
    const { segments } = decoded;
    if (segments.length !== 2) {
        return `jsonPointer "${pointer}" must address exactly one record (collection/key)`;
    }
    const [collection, key] = segments as [string, string];
    const expected = TEMPLATE_COLLECTIONS[template];
    if (collection !== expected) {
        return `template "${template}" requires a pointer into /${expected}, got "/${collection}"`;
    }

    if (template === 'fact') {
        if (!Object.hasOwn(audit.facts, key)) return `unknown fact id "${key}"`;
        const fact = audit.facts[key];
        if (!isPlainObject(fact)) return `fact "${key}" is not an observed fact record`;
        const value = fact.value;
        if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
            return `fact "${key}" is not an allow-listed scalar observation`;
        }
        return null;
    }

    if (template === 'action') {
        // Actions carry stable ids, so the pointer addresses a recorded action, not an array index.
        const action = audit.actions.find((item) => item.id === key);
        return action ? null : `unknown action id "${key}"`;
    }

    if (!Object.hasOwn(audit.limits ?? {}, key)) return `unknown limit id "${key}"`;
    return null;
}

/** Validate every section/claim and collect the full diagnostic list (no early exit). */
function validateNarrativeObject(
    value: Record<string, unknown>,
    audit: AuditArtifact,
    auditDigest: string,
): NarrativeValidation {
    const diagnostics: string[] = [];
    const reject = (message: string): NarrativeValidation => {
        diagnostics.push(message);
        return { status: 'rejected', sections: [], diagnostics };
    };

    const rootProblem = exactKeys(value, ['schemaVersion', 'runId', 'auditDigest', 'sections']);
    if (rootProblem) return reject(`narrative root: ${rootProblem}`);
    if (value.schemaVersion !== 1)
        return reject(`narrative schemaVersion must be 1, got "${String(value.schemaVersion)}"`);
    if (value.runId !== audit.runId)
        return reject(`narrative runId "${String(value.runId)}" does not match the audit runId`);
    if (value.auditDigest !== auditDigest) {
        return reject(
            'narrative auditDigest does not match the materialized audit.json digest (stale or unknown digest)',
        );
    }
    if (!Array.isArray(value.sections)) return reject('narrative sections must be an array');
    if (value.sections.length === 0) return reject('narrative sections must not be empty');

    const sections: NarrativeSection[] = [];
    let claimCount = 0;

    value.sections.forEach((rawSection, sectionIndex) => {
        if (!isPlainObject(rawSection)) {
            diagnostics.push(`sections[${sectionIndex}]: not an object`);
            return;
        }
        const sectionProblem = exactKeys(rawSection, ['heading', 'claims']);
        if (sectionProblem) {
            diagnostics.push(`sections[${sectionIndex}]: ${sectionProblem}`);
            return;
        }
        const heading = rawSection.heading;
        if (typeof heading !== 'string' || !(NARRATIVE_HEADINGS as readonly string[]).includes(heading)) {
            diagnostics.push(`sections[${sectionIndex}]: heading "${String(heading)}" is not an allow-listed heading`);
            return;
        }
        if (!Array.isArray(rawSection.claims) || rawSection.claims.length === 0) {
            diagnostics.push(`sections[${sectionIndex}]: claims must be a non-empty array`);
            return;
        }

        const claims: NarrativeClaim[] = [];
        rawSection.claims.forEach((rawClaim, claimIndex) => {
            claimCount += 1;
            const at = `sections[${sectionIndex}].claims[${claimIndex}]`;
            if (!isPlainObject(rawClaim)) {
                diagnostics.push(`${at}: not an object`);
                return;
            }
            const claimProblem = exactKeys(rawClaim, ['template', 'evidenceRef']);
            if (claimProblem) {
                diagnostics.push(`${at}: ${claimProblem}`);
                return;
            }
            const template = rawClaim.template;
            if (typeof template !== 'string' || !(NARRATIVE_TEMPLATES as readonly string[]).includes(template)) {
                diagnostics.push(`${at}: template "${String(template)}" is not an allow-listed template`);
                return;
            }
            if (!isPlainObject(rawClaim.evidenceRef)) {
                diagnostics.push(`${at}: evidenceRef must be an object`);
                return;
            }
            const refProblem = exactKeys(rawClaim.evidenceRef, ['artifact', 'jsonPointer']);
            if (refProblem) {
                diagnostics.push(`${at}: evidenceRef ${refProblem}`);
                return;
            }
            if (rawClaim.evidenceRef.artifact !== 'audit.json') {
                diagnostics.push(`${at}: evidenceRef.artifact must be "audit.json"`);
                return;
            }
            const pointer = rawClaim.evidenceRef.jsonPointer;
            const resolveProblem = resolveClaim(audit, template as NarrativeTemplate, pointer as string);
            if (resolveProblem) {
                diagnostics.push(`${at}: ${resolveProblem}`);
                return;
            }
            claims.push({
                template: template as NarrativeTemplate,
                evidenceRef: { artifact: 'audit.json', jsonPointer: pointer as string },
            });
        });

        sections.push({ heading: heading as NarrativeHeading, claims });
    });

    if (claimCount > NARRATIVE_MAX_CLAIMS) {
        diagnostics.push(`narrative has ${claimCount} claims, exceeding the ${NARRATIVE_MAX_CLAIMS}-claim limit`);
    }
    if (diagnostics.length > 0) return { status: 'rejected', sections: [], diagnostics };
    return { status: 'included', sections, diagnostics: [] };
}

/**
 * Validate a serialized narrative against the audit it cites.
 *
 * Any invalid claim rejects the ENTIRE narrative; the caller falls back to the
 * deterministic summary and persists the diagnostics. Unreadable/oversize/unknown
 * shape is a rejection, never an audit failure.
 */
export function validateNarrative(raw: string, audit: AuditArtifact, auditDigest: string): NarrativeValidation {
    const byteLength = Buffer.byteLength(raw, 'utf-8');
    if (byteLength > NARRATIVE_MAX_BYTES) {
        return {
            status: 'rejected',
            sections: [],
            diagnostics: [`narrative is ${byteLength} bytes, exceeding the ${NARRATIVE_MAX_BYTES}-byte limit`],
        };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        return { status: 'rejected', sections: [], diagnostics: [`narrative is not valid JSON: ${String(err)}`] };
    }
    if (!isPlainObject(parsed)) {
        return { status: 'rejected', sections: [], diagnostics: ['narrative root must be a JSON object'] };
    }
    return validateNarrativeObject(parsed, audit, auditDigest);
}

/** Render one resolved claim through its fixed, method-owned template. */
function renderClaim(audit: AuditArtifact, claim: NarrativeClaim): string {
    const segments = claim.evidenceRef.jsonPointer
        .slice(1)
        .split('/')
        .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
    const key = segments[1] ?? '';

    if (claim.template === 'fact') {
        const fact = audit.facts[key];
        const value = fact.value === null ? 'none' : String(fact.value);
        return `- **Observed fact** \`${escapeMarkdown(key)}\` = \`${escapeMarkdown(value)}\`${fact.unit ? ` ${escapeMarkdown(fact.unit)}` : ''} — source: \`${escapeMarkdown(fact.source)}\``;
    }
    if (claim.template === 'action') {
        const action = audit.actions.find((item) => item.id === key) as ActionItem;
        return `- **Planned action** \`${escapeMarkdown(action.id)}\` (${action.severity}, ${action.priority}) — ${escapeMarkdown(action.title)} — ${action.affectedPagesCount} affected page(s), effort band ${action.effort}`;
    }
    const limits = (audit.limits ?? {}) as Record<string, unknown>;
    const unit = LIMIT_UNITS[key] ?? '';
    const value = Object.hasOwn(limits, key) ? limits[key] : undefined;
    const rendered = value === null || value === undefined ? 'none' : String(value);
    return `- **Recorded limit** \`${escapeMarkdown(key)}\` = \`${escapeMarkdown(rendered)}\`${unit ? ` ${escapeMarkdown(unit)}` : ''}`;
}

/** Render validated narrative sections; agents order references, never measurements. */
export function renderNarrativeSections(audit: AuditArtifact, sections: NarrativeSection[]): string {
    const lines: string[] = [];
    const headingLabels: Record<NarrativeHeading, string> = {
        summary: 'Summary',
        priorities: 'Priorities',
        limits: 'Limits',
    };
    for (const section of sections) {
        lines.push(`### ${headingLabels[section.heading]}`);
        lines.push('');
        for (const claim of section.claims) lines.push(renderClaim(audit, claim));
        lines.push('');
    }
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
}

/**
 * Deterministic fallback summary: coverage, category scores, action counts and crawler
 * limits. Emitted when no narrative was supplied, or when one was rejected.
 */
export function renderDeterministicSummary(audit: AuditArtifact): string {
    const score = (value: number | null): string => (value === null ? 'N/A (no eligible rules)' : `${value}/100`);
    const counts = { P1: 0, P2: 0, P3: 0, review: 0 };
    for (const action of audit.actions) counts[action.priority] += 1;
    const limits = (audit.limits ?? {}) as Record<string, unknown>;
    const ratioCopy =
        audit.coverage.ratio === null ? 'N/A (no eligible rules)' : `${Math.round(audit.coverage.ratio * 100)}%`;
    return [
        `- Coverage: ${audit.coverage.assessed} assessed of ${audit.coverage.applicableRules} applicable checks (${ratioCopy}), ${audit.coverage.unknown} unknown of ${audit.coverage.totalRules} rules.`,
        `- Category scores: technical ${score(audit.scores.technical)}, content ${score(audit.scores.content)}, crawl ${score(audit.scores.crawl)}, security ${score(audit.scores.security)}.`,
        `- Prioritized actions: ${audit.actions.length} (P1 ${counts.P1}, P2 ${counts.P2}, P3 ${counts.P3}, review ${counts.review}).`,
        `- Crawl limits: pages ${String(limits.pagesVisited ?? 'unknown')}, requests ${String(limits.requestsMade ?? 'unknown')}, bytes ${String(limits.totalBytes ?? 'unknown')}, elapsed ${String(limits.elapsedSeconds ?? 'unknown')}s, hit limit ${limits.hitLimit === null || limits.hitLimit === undefined ? 'none' : String(limits.hitLimit)}.`,
    ].join('\n');
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
