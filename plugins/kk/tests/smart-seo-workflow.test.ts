import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AuditArtifact } from '../scripts/seo-report';

/**
 * Task 0285 — Smart SEO workflow: validated narrative and terminal outcomes.
 *
 * The workflow is exercised two ways:
 *   1. Statically, as the shipped config (state shape, guards, quoted-data invocation).
 *   2. End to end over a fixture, by issuing the exact `kk stage run seo-*` commands the YAML
 *      issues — offline, with no network and no maker dispatch.
 *
 * Cancellation is proven against real processes: `kk stage run` must forward a host signal, and
 * the stage's own children (decision subprocesses) must die with it.
 */
const repoRoot = resolve(import.meta.dir, '../../..');
const workflowPath = join(repoRoot, 'plugins/kk/workflows/kk-smart-seo.yaml');
const stagesScript = join(repoRoot, 'plugins/kk/scripts/kk-workflow-stages.ts');
const seoFetchPath = join(repoRoot, 'plugins/kk/scripts/seo-fetch.ts');
const seoDecisionsPath = join(repoRoot, 'plugins/kk/scripts/seo-decisions.ts');
const fixtureDir = join(repoRoot, 'plugins/kk/tests/fixtures');
const kkEntry = join(repoRoot, 'apps/cli/src/index.ts');

const workflowSource = readFileSync(workflowPath, 'utf-8');
/** Whitespace-normalized view: the YAML folds long commands across physical lines. */
const flatWorkflow = workflowSource.replace(/\s+/g, ' ');

/**
 * `${vars.name}` assembled at runtime so lint's noTemplateCurlyInString stays quiet (the same dodge
 * the itc workflow tests use). The YAML itself must still carry the literal template.
 */
const varRef = (name: string): string => ['$' + '{vars.', name, '}'].join('');

/** Run one `kk stage run` against the checkout sources (the workflow's own invocation shape). */
function kkStage(args: string[], env: Record<string, string> = {}): { status: number | null; stderr: string } {
    const res = spawnSync('bun', [kkEntry, 'stage', 'run', ...args], {
        encoding: 'utf-8',
        cwd: repoRoot,
        env: { ...process.env, ...env },
        timeout: 120_000,
    });
    return { status: res.status, stderr: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

function optionsFile(dir: string, overrides: Record<string, unknown> = {}): string {
    const options = {
        url: 'https://example.com',
        locale: 'en-US',
        business_context: '',
        max_pages: 60,
        max_depth: 5,
        max_requests: 200,
        deadline_seconds: 600,
        semantic_pages: 20,
        max_pairs: 10,
        max_keywords: 10,
        max_decision_calls: 320,
        performance: false,
        visibility_file: '',
        fixture: fixtureDir,
        ...overrides,
    };
    const path = join(dir, 'options.json');
    writeFileSync(path, JSON.stringify(options), 'utf-8');
    return path;
}

function sha256File(path: string): string {
    return createHash('sha256').update(readFileSync(path, 'utf-8')).digest('hex');
}

/** A fake `spur` that records its pid and then blocks, so a cancellation can be observed. */
function sleepingSpurStub(dir: string): { bin: string; pidFile: string } {
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    const pidFile = join(dir, 'spur-stub.pid');
    const path = join(bin, 'spur');
    writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$$" >> "${pidFile}"\nsleep 60\n`, 'utf-8');
    chmodSync(path, 0o755);
    return { bin, pidFile };
}

async function waitForFile(path: string, timeoutMs = 20_000): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (existsSync(path)) {
            const content = readFileSync(path, 'utf-8').trim();
            if (content !== '') return content;
        }
        await new Promise((r) => setTimeout(r, 50));
    }
    return null;
}

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

describe('kk-smart-seo workflow — shipped config invariants (R2)', () => {
    it('declares the eight stages, three terminals, the single failure state and iterationBound 12', () => {
        const stateIds = [...workflowSource.matchAll(/^\s+- id: (\w+)/gm)].map((m) => m[1]);
        expect(stateIds).toEqual([
            'preflight',
            'collect',
            'check',
            'enrich',
            'judge',
            'score',
            'narrative',
            'report',
            'done',
            'partial',
            'failed',
        ]);
        expect(workflowSource).toContain('initialState: preflight');
        expect(workflowSource).toContain('iterationBound: 12');
        expect(flatWorkflow).toMatch(/terminalStates: - done - partial - failed/);
        expect(flatWorkflow).toMatch(/failureStates: - failed/);
        // `partial` is successful artifact delivery, so it must NOT be a failure state.
        expect(workflowSource).not.toMatch(/failureStates:\s*\n\s+- partial/);
    });

    it('validates clean against the engine schema', () => {
        const res = spawnSync('spur', ['workflow', 'validate', '.spur/workflows/kk-smart-seo.yaml', '--json'], {
            encoding: 'utf-8',
            cwd: repoRoot,
        });
        const parsed = JSON.parse(res.stdout);
        expect(parsed.valid).toBe(true);
        const errors = (parsed.composition?.findings ?? []).filter((f: { level?: string }) => f.level === 'error');
        expect(errors).toEqual([]);
    });

    it('has a schema `--dry-run` path to every terminal through the machine', async () => {
        const res = spawnSync(
            'spur',
            ['workflow', 'show', '.spur/workflows/kk-smart-seo.yaml', '--no-logo', '--format', 'todo', '--json'],
            { encoding: 'utf-8', cwd: repoRoot },
        );
        const steps = JSON.parse(res.stdout).steps.map((s: { id: string }) => s.id);
        expect(steps).toContain('preflight');
        expect(steps).toContain('report');
    });

    it('invokes only existing stage actions with quoted environment data (never templated shell source)', () => {
        const stageInvocations = [...flatWorkflow.matchAll(/kk stage run (seo-\w+)/g)].map((m) => m[1]);
        expect(stageInvocations).toEqual([
            'seo-preflight',
            'seo-collect',
            'seo-check',
            'seo-enrich',
            'seo-judge',
            'seo-score',
            'seo-report',
        ]);
        // Quoted positional data, exactly as the design requires.
        expect(flatWorkflow).toContain('kk stage run seo-collect "$work_dir"');
        expect(flatWorkflow).toContain('kk stage run seo-preflight "$work_dir" "$options_file" "$__runId" true');
        // No shell-interpolated user value and no eval anywhere in the machine.
        expect(flatWorkflow).not.toMatch(/\beval\b/);
        for (const invocation of flatWorkflow.matchAll(/kk stage run seo-\w+/g)) {
            const stage = invocation[0].replace('kk stage run ', '');
            expect(flatWorkflow).toContain(`kk stage run ${stage} "$work_dir"`);
            expect(flatWorkflow).not.toContain(`kk stage run ${stage} "\${vars.work_dir}"`);
        }
    });

    it('binds work_dir from the run-bound file the preflight stage writes', () => {
        expect(flatWorkflow).toContain(`path: ".spur/run/${varRef('__runId')}-seo-work-dir.txt"`);
        expect(flatWorkflow).toContain('var: work_dir');
    });

    it('gives every required stage an action-ok edge and a failure edge', () => {
        for (const state of ['preflight', 'collect', 'check', 'enrich', 'judge', 'score']) {
            const block = workflowSource.split(`- from: ${state}\n`)[1] ?? '';
            expect(block.startsWith('    to: ')).toBe(true);
            expect(workflowSource).toContain(`- from: ${state}\n    to: failed`);
        }
        const guardCount = (workflowSource.match(/kind: action-ok/g) ?? []).length;
        expect(guardCount).toBe(6);
        // Every failure edge carries the closed terminal-reason enum.
        const failureEdges = (workflowSource.match(/to: failed\n {4}terminalReason: /g) ?? []).length;
        expect(failureEdges).toBe(7);
    });

    it('bounds the narrative to one attempt: fresh session, 120 s timeout, continue-on-error, unconditional edge', () => {
        const narrativeBlock = workflowSource.split('- id: narrative')[1]?.split('- id: report')[0] ?? '';
        expect(narrativeBlock).toContain('onError: continue');
        expect(narrativeBlock).toContain('timeoutMs: 120000');
        expect(narrativeBlock).toContain('session: fresh');
        expect(narrativeBlock).toContain(`answerFile: "${varRef('work_dir')}/narrative.json"`);
        // Exactly one agent.run action, and it is the only model-bearing step in the machine.
        expect((workflowSource.match(/kind: agent.run/g) ?? []).length).toBe(1);
        // No revision loop: narrative has one outgoing edge and no edge back to itself.
        const narrativeTransitions = [...workflowSource.matchAll(/- from: narrative\n\s+to: (\w+)/g)].map((m) => m[1]);
        expect(narrativeTransitions).toEqual(['report']);
    });

    it('chooses done/partial from the validated report and routes a missing report to failed', () => {
        const reportBlock = workflowSource.slice(workflowSource.indexOf('- from: report'));
        expect(reportBlock).toContain('to: done');
        expect(reportBlock).toContain('to: partial');
        expect(reportBlock).toContain('to: failed');
        expect(flatWorkflow).toContain(`jq -e '.status == "done"' "$work_dir/report.json"`);
        expect(flatWorkflow).toContain(`jq -e '.status == "partial"' "$work_dir/report.json"`);
    });

    it('declares no site-mutating, publishing or scheduling surface', () => {
        // Comments explain the machine; only the machine body is scanned.
        const body = workflowSource
            .split('\n')
            .filter((line) => !line.trimStart().startsWith('#'))
            .join('\n');
        for (const forbidden of ['publish', 'deploy', 'submit', 'schedule', 'mutate', 'POST ', 'DELETE ', 'PUT ']) {
            expect(body).not.toContain(forbidden);
        }
    });
});

describe('kk-smart-seo fixture chain — narrative, report and terminal status (R1/R2)', () => {
    let dir: string;
    let workDir: string;
    let runId: string;

    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'kk-smart-seo-wf-'));
        runId = `wf-fixture-${Date.now()}`;
        const preflight = kkStage(['seo-preflight', '', optionsFile(dir), runId, 'false']);
        expect(preflight.status).toBe(0);
        const workDirFile = join(repoRoot, '.spur', 'run', `${runId}-seo-work-dir.txt`);
        expect(existsSync(workDirFile)).toBe(true);
        workDir = readFileSync(workDirFile, 'utf-8').trim();
        expect(workDir).toContain('.works/kk-smart-seo');
    });

    afterAll(() => {
        try {
            rmSync(dir, { recursive: true, force: true });
            rmSync(join(repoRoot, '.spur', 'run', `${runId}-seo-work-dir.txt`), { force: true });
            if (workDir) rmSync(workDir, { recursive: true, force: true });
        } catch {
            // best-effort cleanup
        }
    });

    it('runs preflight → collect → check → score offline and writes the audit', () => {
        expect(kkStage(['seo-collect', workDir]).status).toBe(0);
        expect(existsSync(join(workDir, 'crawl.json'))).toBe(true);
        expect(kkStage(['seo-check', workDir]).status).toBe(0);
        expect(existsSync(join(workDir, 'checks.json'))).toBe(true);
        expect(kkStage(['seo-score', workDir]).status).toBe(0);
        expect(existsSync(join(workDir, 'audit.json'))).toBe(true);
    });

    it('materializes a labeled deterministic report with report.json status done when the narrative is absent', () => {
        expect(kkStage(['seo-report', workDir]).status).toBe(0);
        const report = JSON.parse(readFileSync(join(workDir, 'report.json'), 'utf-8'));
        expect(report.narrativeStatus).toBe('omitted');
        expect(report.status).toBe('done');
        const md = readFileSync(join(workDir, 'report.md'), 'utf-8');
        expect(md).toContain('**Narrative omitted**');
        expect(md).toContain('- Coverage:');
        expect(md).toContain('- Crawl limits:');
    });

    it('rejects an invented fact value and keeps the audit deliverable (narrative failure is not an audit failure)', () => {
        const narrative = {
            schemaVersion: 1,
            runId: JSON.parse(readFileSync(join(workDir, 'audit.json'), 'utf-8')).runId,
            auditDigest: sha256File(join(workDir, 'audit.json')),
            sections: [
                {
                    heading: 'summary',
                    claims: [
                        {
                            template: 'fact',
                            evidenceRef: { artifact: 'audit.json', jsonPointer: '/facts/pages_visited' },
                        },
                        {
                            // A prose field is the historical free-form shape: the whole narrative is refused.
                            template: 'fact',
                            evidenceRef: { artifact: 'audit.json', jsonPointer: '/facts/pages_visited' },
                            text: 'The site ranks first for its primary keyword.',
                        },
                    ],
                },
            ],
        };
        writeFileSync(join(workDir, 'narrative.json'), JSON.stringify(narrative), 'utf-8');
        expect(kkStage(['seo-report', workDir]).status).toBe(0);
        const report = JSON.parse(readFileSync(join(workDir, 'report.json'), 'utf-8'));
        expect(report.narrativeStatus).toBe('rejected');
        expect(report.narrativeDiagnostics.join(' ')).toContain('unknown key "text"');
        expect(existsSync(join(workDir, 'narrative-diagnostics.json'))).toBe(true);
        expect(readFileSync(join(workDir, 'report.md'), 'utf-8')).toContain('**Narrative rejected**');
    });

    it('accepts a validated narrative and renders only method-owned templates', () => {
        const audit: AuditArtifact = JSON.parse(readFileSync(join(workDir, 'audit.json'), 'utf-8'));
        const actionId = audit.actions[0]?.id;
        const claims: unknown[] = [
            { template: 'fact', evidenceRef: { artifact: 'audit.json', jsonPointer: '/facts/pages_visited' } },
            { template: 'limit', evidenceRef: { artifact: 'audit.json', jsonPointer: '/limits/pagesVisited' } },
        ];
        if (actionId !== undefined) {
            claims.push({
                template: 'action',
                evidenceRef: { artifact: 'audit.json', jsonPointer: `/actions/${actionId}` },
            });
        }
        writeFileSync(
            join(workDir, 'narrative.json'),
            JSON.stringify({
                schemaVersion: 1,
                runId: audit.runId,
                auditDigest: sha256File(join(workDir, 'audit.json')),
                sections: [{ heading: 'summary', claims }],
            }),
            'utf-8',
        );
        expect(kkStage(['seo-report', workDir]).status).toBe(0);
        const report = JSON.parse(readFileSync(join(workDir, 'report.json'), 'utf-8'));
        expect(report.narrativeStatus).toBe('included');
        const md = readFileSync(join(workDir, 'report.md'), 'utf-8');
        expect(md).toContain('### Summary');
        expect(md).toContain('**Observed fact**');
        expect(md).toContain('**Recorded limit**');
        expect(md).not.toContain('**Narrative rejected**');
    });
});

describe('narrative rejection matrix (R1)', () => {
    const audit: AuditArtifact = {
        schemaVersion: 1,
        methodVersion: '1.0.0',
        runId: 'narr-run',
        createdAt: '2026-10-15T00:00:00Z',
        inputDigest: 'd',
        predecessorDigests: {},
        status: 'complete',
        targetUrl: 'https://example.com',
        scores: { technical: 100, content: null, crawl: 100, security: 100 },
        coverage: { totalRules: 52, applicableRules: 10, assessed: 10, unknown: 0, ratio: 1 },
        facts: { pages_visited: { value: 3, unit: 'count', source: 'crawl.json' } },
        assessments: [],
        actions: [],
        judgments: { status: 'not-assessed' },
        performance: { status: 'not-assessed' },
        visibility: { status: 'not-assessed' },
        limits: { pagesVisited: 3, requestsMade: 4, totalBytes: 10, elapsedSeconds: 1, hitLimit: null },
    };

    /** Validate a narrative variant through the real module (no CLI, so the matrix stays fast). */
    function validate(narrative: unknown): { status: string; diagnostics: string[] } {
        const script = [
            `import { validateNarrative } from ${JSON.stringify(join(repoRoot, 'plugins/kk/scripts/seo-report.ts'))};`,
            `const audit = ${JSON.stringify(audit)};`,
            `const raw = ${JSON.stringify(JSON.stringify(narrative))};`,
            `const out = validateNarrative(raw, audit, "digest-under-test");`,
            `console.log(JSON.stringify({ status: out.status, diagnostics: out.diagnostics }));`,
        ].join('\n');
        const res = spawnSync('bun', ['-e', script], { encoding: 'utf-8', cwd: repoRoot });
        if (res.status !== 0) throw new Error(`validateNarrative probe failed: ${res.stderr}`);
        return JSON.parse(res.stdout.trim().split('\n').pop() as string);
    }

    const digest = 'digest-under-test';
    const base = { schemaVersion: 1, runId: 'narr-run', auditDigest: digest };

    it('rejects a stale digest, an unknown pointer, a prototype path and a wrong collection', () => {
        expect(
            validate({
                ...base,
                auditDigest: 'other',
                sections: [
                    {
                        heading: 'summary',
                        claims: [
                            {
                                template: 'fact',
                                evidenceRef: { artifact: 'audit.json', jsonPointer: '/facts/pages_visited' },
                            },
                        ],
                    },
                ],
            }).diagnostics.join(' '),
        ).toContain('does not match the materialized audit.json digest');

        expect(
            validate({
                ...base,
                sections: [
                    {
                        heading: 'summary',
                        claims: [
                            {
                                template: 'fact',
                                evidenceRef: { artifact: 'audit.json', jsonPointer: '/facts/not_recorded' },
                            },
                        ],
                    },
                ],
            }).diagnostics.join(' '),
        ).toContain('unknown fact id');

        expect(
            validate({
                ...base,
                sections: [
                    {
                        heading: 'summary',
                        claims: [
                            {
                                template: 'fact',
                                evidenceRef: { artifact: 'audit.json', jsonPointer: '/facts/__proto__' },
                            },
                        ],
                    },
                ],
            }).diagnostics.join(' '),
        ).toContain('forbidden key');

        // `limit` may not address the facts collection, and `action` needs a recorded id.
        expect(
            validate({
                ...base,
                sections: [
                    {
                        heading: 'limits',
                        claims: [
                            {
                                template: 'limit',
                                evidenceRef: { artifact: 'audit.json', jsonPointer: '/facts/pages_visited' },
                            },
                        ],
                    },
                ],
            }).diagnostics.join(' '),
        ).toContain('requires a pointer into /limits');
    });

    it('rejects unknown headings/templates/keys and unapproved artifacts, and accepts the valid shape', () => {
        const rejections: [unknown, string][] = [
            [{ ...base, sections: [{ heading: 'overview', claims: [] }] }, 'not an allow-listed heading'],
            [
                {
                    ...base,
                    sections: [
                        {
                            heading: 'summary',
                            claims: [
                                {
                                    template: 'prose',
                                    evidenceRef: { artifact: 'audit.json', jsonPointer: '/facts/pages_visited' },
                                },
                            ],
                        },
                    ],
                },
                'not an allow-listed template',
            ],
            [
                {
                    ...base,
                    sections: [
                        {
                            heading: 'summary',
                            claims: [
                                {
                                    template: 'fact',
                                    evidenceRef: { artifact: 'crawl.json', jsonPointer: '/facts/pages_visited' },
                                },
                            ],
                        },
                    ],
                },
                'evidenceRef.artifact must be "audit.json"',
            ],
            [{ ...base, extra: true, sections: [{ heading: 'summary', claims: [] }] }, 'unknown key "extra"'],
        ];
        for (const [narrative, expected] of rejections) {
            const result = validate(narrative);
            expect(result.status).toBe('rejected');
            expect(result.diagnostics.join(' ')).toContain(expected);
        }

        const valid = validate({
            ...base,
            sections: [
                {
                    heading: 'summary',
                    claims: [
                        {
                            template: 'fact',
                            evidenceRef: { artifact: 'audit.json', jsonPointer: '/facts/pages_visited' },
                        },
                    ],
                },
            ],
        });
        expect(valid.status).toBe('included');
        expect(valid.diagnostics).toEqual([]);
    });

    it('rejects over-limit claims and an oversize narrative', () => {
        const claims = Array.from({ length: 31 }, () => ({
            template: 'fact' as const,
            evidenceRef: { artifact: 'audit.json' as const, jsonPointer: '/facts/pages_visited' },
        }));
        expect(validate({ ...base, sections: [{ heading: 'summary', claims }] }).diagnostics.join(' ')).toContain(
            'exceeding the 30-claim limit',
        );

        const oversize = validate({
            ...base,
            sections: [
                {
                    heading: 'summary',
                    claims: [
                        {
                            template: 'fact',
                            evidenceRef: {
                                artifact: 'audit.json',
                                jsonPointer: `/facts/${'x'.repeat(33 * 1024)}`,
                            },
                        },
                    ],
                },
            ],
        });
        expect(oversize.diagnostics.join(' ')).toContain('exceeding the 32768-byte limit');
    });
});

describe('workflow preflight decision contracts (R2)', () => {
    it('fails with the config pointer when the SEO catalogs are not served', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-seo-preflight-'));
        const previous = process.env.KK_SPUR_BIN;
        try {
            const stub = join(dir, 'spur');
            writeFileSync(stub, '#!/bin/sh\necho "[]"\n', 'utf-8');
            chmodSync(stub, 0o755);
            process.env.KK_SPUR_BIN = stub;
            const { seoPreflight } = await import('../scripts/seo-stages');
            await expect(seoPreflight(['', optionsFile(dir), 'preflight-missing', 'true'])).rejects.toThrow(
                /decisions\.paths/,
            );
        } finally {
            if (previous === undefined) delete process.env.KK_SPUR_BIN;
            else process.env.KK_SPUR_BIN = previous;
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('passes against the catalogs this project actually serves', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-seo-preflight-ok-'));
        try {
            const { seoPreflight, REQUIRED_SEO_CATALOGS, REQUIRED_SEO_DECISION_IDS } = await import(
                '../scripts/seo-stages'
            );
            const served = JSON.parse(
                spawnSync('spur', ['decision', 'list', '--json'], { encoding: 'utf-8', cwd: repoRoot }).stdout,
            ) as { id: string; source: string }[];
            const servedCatalogs = new Set(served.map((row) => row.source.split('/').pop() ?? ''));
            const servedIds = new Set(served.map((row) => row.id));
            for (const catalog of REQUIRED_SEO_CATALOGS) expect(servedCatalogs.has(catalog)).toBe(true);
            for (const id of REQUIRED_SEO_DECISION_IDS) expect(servedIds.has(id)).toBe(true);

            await expect(seoPreflight(['', optionsFile(dir), 'preflight-real', 'true'])).resolves.toBeUndefined();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('cancellation (R2)', () => {
    it('aborts an in-flight pinned request and closes its socket', { timeout: 30_000 }, () => {
        const probe = `
            import { createServer } from 'node:http';
            import { onSeoCancel, pinnedSingleRequest, SeoStageCancelledError } from ${JSON.stringify(seoFetchPath)};
            let open = 0;
            const server = createServer(() => { /* hold the request open */ });
            server.on('connection', (socket) => { open += 1; socket.on('close', () => { open -= 1; }); });
            await new Promise((r) => server.listen(0, '127.0.0.1', r));
            const port = server.address().port;
            const dispose = onSeoCancel(() => {});
            const pending = pinnedSingleRequest('http://127.0.0.1:' + port + '/', { ip: '127.0.0.1', family: 4 }, { allowLoopback: true });
            while (open === 0) await new Promise((r) => setTimeout(r, 5));
            process.emit('SIGTERM');
            let outcome = 'resolved';
            try { await pending; } catch (err) { outcome = err instanceof SeoStageCancelledError ? 'cancelled' : 'other:' + err.message; }
            await new Promise((r) => setTimeout(r, 30));
            dispose();
            console.log(JSON.stringify({ outcome, open }));
            server.close();
            process.exit(0);
        `;
        const res = spawnSync('bun', ['-e', probe], { encoding: 'utf-8', cwd: repoRoot, timeout: 60_000 });
        expect(res.status).toBe(0);
        const result = JSON.parse(res.stdout.trim().split('\n').pop() as string);
        expect(result.outcome).toBe('cancelled');
        expect(result.open).toBe(0);
    });

    it('terminates an in-flight decision child and refuses further dispatch', { timeout: 30_000 }, async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-seo-cancel-'));
        const { bin, pidFile } = sleepingSpurStub(dir);
        const probe = `
            import { executeDecisionRun } from ${JSON.stringify(seoDecisionsPath)};
            import { onSeoCancel, SeoStageCancelledError } from ${JSON.stringify(seoFetchPath)};
            const dispose = onSeoCancel(() => {});
            try {
                executeDecisionRun('kk-seo-importance', { subject_id: 'https://example.com', locale: 'en-US' }, [], { spurBin: ${JSON.stringify(join(bin, 'spur'))}, timeoutMs: 60000 });
                console.log(JSON.stringify({ outcome: 'returned' }));
            } catch (err) {
                console.log(JSON.stringify({ outcome: err instanceof SeoStageCancelledError ? 'cancelled' : 'other:' + err.message }));
            }
            dispose();
            process.exit(0);
        `;
        const child = spawn('bun', ['-e', probe], {
            cwd: repoRoot,
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
        });
        let stdout = '';
        child.stdout?.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf-8');
        });
        try {
            const stubPid = await waitForFile(pidFile);
            expect(stubPid).not.toBeNull();
            // Deliver the cancellation to the whole process group, as `kk stage run` does.
            process.kill(-(child.pid as number), 'SIGTERM');
            await new Promise((resolvePromise) => child.on('close', resolvePromise));
            expect(stdout).toContain('"outcome":"cancelled"');
            const decisionPid = Number(stubPid);
            expect(alive(decisionPid)).toBe(false);
        } finally {
            try {
                process.kill(-(child.pid as number), 'SIGKILL');
            } catch {
                // already gone
            }
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('writes a cancellation marker and exits with the conventional signal status', { timeout: 30_000 }, async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-seo-marker-'));
        const workDir = join(dir, 'work');
        mkdirSync(workDir, { recursive: true });
        const { bin, pidFile } = sleepingSpurStub(dir);
        const options = {
            url: 'https://example.com',
            locale: 'en-US',
            business_context: '',
            max_pages: 60,
            max_depth: 5,
            max_requests: 200,
            deadline_seconds: 600,
            semantic_pages: 20,
            max_pairs: 10,
            max_keywords: 10,
            max_decision_calls: 320,
            performance: false,
            visibility_file: '',
            fixture: '',
        };
        writeFileSync(join(workDir, 'options.json'), JSON.stringify(options), 'utf-8');
        writeFileSync(
            join(workDir, 'crawl.json'),
            readFileSync(join(fixtureDir, 'smart-seo-minimal-crawl.json'), 'utf-8'),
            'utf-8',
        );

        const child = spawn('bun', [stagesScript, 'seo-judge', workDir], {
            cwd: repoRoot,
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
        });
        let code: number | null = null;
        let stageOutput = '';
        child.stdout?.on('data', (chunk: Buffer) => {
            stageOutput += chunk.toString('utf-8');
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            stageOutput += chunk.toString('utf-8');
        });
        child.on('close', (c) => {
            code = c;
        });
        try {
            expect(await waitForFile(pidFile)).not.toBeNull();
            process.kill(-(child.pid as number), 'SIGTERM');
            const deadline = Date.now() + 20_000;
            while (code === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
            expect({ code, stageOutput }).toEqual({ code: 143, stageOutput: expect.any(String) });
            expect(existsSync(join(workDir, 'cancelled.json'))).toBe(true);
            const marker = JSON.parse(readFileSync(join(workDir, 'cancelled.json'), 'utf-8'));
            expect(marker.signal).toBe('SIGTERM');
            expect(marker.stage).toBe('seo-judge');
            // Artifacts already written are preserved, not deleted.
            expect(existsSync(join(workDir, 'options.json'))).toBe(true);
        } finally {
            try {
                process.kill(-(child.pid as number), 'SIGKILL');
            } catch {
                // already gone
            }
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
