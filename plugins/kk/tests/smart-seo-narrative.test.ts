import { describe, expect, it } from 'bun:test';
import {
    type AuditArtifact,
    NARRATIVE_MAX_BYTES,
    renderDeterministicSummary,
    renderNarrativeSections,
    renderReportMarkdown,
    validateNarrative,
} from '../scripts/seo-report';

/**
 * In-process narrative validation and rendering (the CLI matrix in smart-seo-workflow runs in a
 * subprocess). Every rejection names the offending section/claim; one bad claim rejects the whole.
 */
const audit: AuditArtifact = {
    schemaVersion: 1,
    methodVersion: '1.0.0',
    runId: 'narr-run',
    createdAt: '2026-10-15T00:00:00Z',
    inputDigest: 'd',
    predecessorDigests: {},
    status: 'complete',
    targetUrl: 'https://example.com',
    scores: { technical: null, content: 80, crawl: null, security: null },
    coverage: { totalRules: 52, applicableRules: 10, assessed: 10, unknown: 0, ratio: null },
    facts: {
        pages_visited: { value: 3, unit: 'count', source: 'crawl.json' },
        no_value: { value: null, source: 'crawl.json' },
        nested: { value: { deep: 1 }, source: 'crawl.json' },
        bare: 'not-a-record',
    } as unknown as AuditArtifact['facts'],
    assessments: [],
    actions: [
        {
            id: 'act-1',
            severity: 'high',
            priority: 'P1',
            title: 'Fix titles',
            affectedPagesCount: 2,
            effort: 'S',
        },
    ] as unknown as AuditArtifact['actions'],
    judgments: { status: 'not-assessed' },
    performance: { status: 'not-assessed' },
    visibility: { status: 'not-assessed' },
    limits: { pagesVisited: 3, requestsMade: 4, totalBytes: 10, elapsedSeconds: 1, hitLimit: null },
};
const digest = 'dg';
const base = { schemaVersion: 1, runId: 'narr-run', auditDigest: digest };
const claim = (template: string, jsonPointer: string, artifact = 'audit.json') => ({
    template,
    evidenceRef: { artifact, jsonPointer },
});
const check = (narrative: unknown) => validateNarrative(JSON.stringify(narrative), audit, digest);
const diag = (narrative: unknown) => check(narrative).diagnostics.join(' | ');

describe('validateNarrative in-process guards', () => {
    it('rejects oversize, non-JSON and non-object input before shape checks', () => {
        expect(validateNarrative('x'.repeat(NARRATIVE_MAX_BYTES + 1), audit, digest).diagnostics[0]).toContain(
            'byte limit',
        );
        expect(validateNarrative('{', audit, digest).diagnostics[0]).toContain('not valid JSON');
        expect(validateNarrative('[]', audit, digest).diagnostics[0]).toBe('narrative root must be a JSON object');
    });

    it('rejects a bad root: version, runId, digest, sections shape', () => {
        expect(diag({ ...base, schemaVersion: 2, sections: [] })).toContain('schemaVersion must be 1');
        expect(diag({ ...base, runId: 'other', sections: [] })).toContain('does not match the audit runId');
        expect(diag({ ...base, auditDigest: 'stale', sections: [] })).toContain('stale or unknown digest');
        expect(diag({ ...base, sections: {} })).toContain('sections must be an array');
        expect(diag({ ...base, sections: [] })).toContain('sections must not be empty');
        expect(diag({ schemaVersion: 1, runId: 'narr-run', auditDigest: digest })).toContain('narrative root:');
    });

    it('collects every section and claim diagnostic without early exit', () => {
        const out = check({
            ...base,
            sections: [
                'not-an-object',
                { heading: 'summary' },
                { heading: 'summary', claims: [] },
                { heading: 'overview', claims: [claim('fact', '/facts/pages_visited')] },
                {
                    heading: 'priorities',
                    claims: [
                        7,
                        { template: 'fact' },
                        { template: 'fact', evidenceRef: 'x' },
                        { template: 'fact', evidenceRef: { artifact: 'audit.json' } },
                        claim('fact', 'facts/pages_visited'),
                        claim('fact', '/facts//x'),
                        claim('fact', '/facts/a\u0000b'),
                        claim('fact', '/facts'),
                        claim('action', '/limits/pagesVisited'),
                        claim('fact', '/facts/bare'),
                        claim('fact', '/facts/nested'),
                        claim('action', '/actions/missing'),
                        claim('limit', '/limits/missing'),
                        claim('fact', '/facts/__proto__'),
                        claim('prose', '/facts/pages_visited'),
                        claim('fact', '/facts/pages_visited', 'crawl.json'),
                    ],
                },
            ],
        });
        expect(out.status).toBe('rejected');
        const all = out.diagnostics.join(' | ');
        for (const expected of [
            'sections[0]: not an object',
            'sections[1]: missing key',
            'sections[2]: claims must be a non-empty array',
            'sections[3]: heading "overview" is not an allow-listed heading',
            'sections[4].claims[0]: not an object',
            'sections[4].claims[1]: missing key',
            'evidenceRef must be an object',
            'evidenceRef missing key',
            'must be a non-empty JSON pointer',
            'has an empty segment',
            'contains a NUL character',
            'must address exactly one record',
            'requires a pointer into /actions',
            'is not an observed fact record',
            'is not an allow-listed scalar observation',
            'unknown action id "missing"',
            'unknown limit id "missing"',
        ]) {
            expect(all).toContain(expected);
        }
    });

    it('includes and renders fact, action and limit claims, including a null fact and null limit', () => {
        const out = check({
            ...base,
            sections: [
                {
                    heading: 'summary',
                    claims: [claim('fact', '/facts/pages_visited'), claim('fact', '/facts/no_value')],
                },
                { heading: 'priorities', claims: [claim('action', '/actions/act-1')] },
                {
                    heading: 'limits',
                    claims: [claim('limit', '/limits/hitLimit'), claim('limit', '/limits/pagesVisited')],
                },
            ],
        });
        expect(out.diagnostics).toEqual([]);
        expect(out.status).toBe('included');
        const md = renderNarrativeSections(audit, out.sections);
        expect(md).toContain('**Planned action** `act\\-1` (high, P1)');
        expect(md).toContain('`no\\_value` = `none`');
        expect(md).toContain('**Recorded limit**');
    });

    it('renders N/A scores and coverage, and the no-action notice', () => {
        const md = renderReportMarkdown({ ...audit, actions: [] });
        expect(md).toContain('N/A (no eligible rules)');
        expect(md).toContain('**Coverage Ratio:** N/A');
        expect(md).toContain('No critical or high action items detected.');
    });
});

describe('narrative claim limit and report markdown variants', () => {
    it('rejects more than the claim limit even when each claim is valid', () => {
        const claims = Array.from({ length: 31 }, () => claim('fact', '/facts/pages_visited'));
        expect(diag({ ...base, sections: [{ heading: 'summary', claims }] })).toContain('30-claim limit');
    });

    it('renders the action table, the deterministic summary and an appended narrative', () => {
        const md = renderReportMarkdown(audit, '### Summary\n\nnarrated');
        expect(md).toContain('| Priority | ID | Severity | Effort | Affected | Description |');
        expect(md).toContain('narrated');
        expect(renderDeterministicSummary(audit)).toContain('Prioritized actions: 1 (P1 1, P2 0, P3 0, review 0)');
    });
});
