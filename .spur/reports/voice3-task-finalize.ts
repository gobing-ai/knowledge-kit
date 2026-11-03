import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const dir = '.spur/reports/voice3-task-plan';
const rows = JSON.parse(readFileSync(`${dir}/tasks.json`, 'utf8'));
const specs = JSON.parse(readFileSync(`${dir}/specs.json`, 'utf8'));
function cli(args: string[], allowFailure = false) {
    const out = Bun.spawnSync(['spur', ...args, '--json'], { stdout: 'pipe', stderr: 'pipe' });
    if (out.exitCode !== 0 && !allowFailure)
        throw new Error(`${args.join(' ')}: ${out.stderr.toString()} ${out.stdout.toString()}`);
    return { exitCode: out.exitCode, result: JSON.parse(out.stdout.toString()) };
}
function section(content: string, name: string) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matched = new RegExp(`^### ${escaped}\\s*\\n([\\s\\S]*?)(?=^### |$(?![\\s\\S]))`, 'm').exec(content);
    const body = matched?.[1];
    if (body === undefined) throw new Error(`missing section ${name}`);
    return body.trim();
}
function update(wbs: string, name: string, text: string) {
    const path = `${dir}/${wbs}-${name.replaceAll(/[^A-Za-z]/g, '')}-final.md`;
    writeFileSync(path, `${text}\n`);
    cli(['task', 'update', wbs, '--section', name, '--from-file', path]);
}
// Remove ambiguity in the launch-only route for explicitly authorized owned live sends.
const schedule = cli(['task', 'show', '0334']).result;
update(
    '0334',
    'Requirements',
    section(schedule.content, 'Requirements') +
        '\n- [ ] R7. Declare voice3 launch var publish_live_channels with empty default and forward it only to nested publish3 live_channels. Explicit live launches preserve send-confirm pause/resume; defaults and preset/config values never imply live consent.',
);
update(
    '0334',
    'Acceptance Criteria',
    section(schedule.content, 'Acceptance Criteria').replace(
        '(req: R1, R2, R3, R4, R5, R6)',
        '(req: R1, R2, R3, R4, R5, R6, R7)',
    ),
);
update(
    '0334',
    'Design',
    section(schedule.content, 'Design').replace(
        '**Ownership:** ',
        '**Ownership:** plugins/kk/workflows/kk-daily-ai-voice3.yaml (launch variable forwarding only); ',
    ) +
        '\n\n**Frozen live launch handoff:** Add publish_live_channels: "" to voice3 launch vars and forward it verbatim to nested publish3 live_channels. It is launch-only, never a config/preset default. The production runbook must choose either an initial explicit live owned launch followed by manual send-confirm resume, or remote operator reconciliation of an existing real draft. It must not draft first and then assume the receipt can silently promote to live; 0332 deliberately refuses that unsafe reuse. Rehearsal launch remains auto_publish=true, publish_preset=daily-ai-voice-migration, publish_dummy=true, publish_live_channels empty.',
);
update('0334', 'Plan', section(schedule.content, 'Plan').replaceAll('R1-R6', 'R1-R7'));
// Expand the shorthand source citation in the independent mode task.
const mode = cli(['task', 'show', '0330']).result;
update(
    '0330',
    'Background',
    section(mode.content, 'Background').replace(
        'podcast-pub/src/map.ts:115',
        'plugins/publishings/podcast-pub/src/map.ts:115',
    ),
);

const coverage: Record<string, string[]> = {};
const ready = [];
for (const row of rows) {
    const shown = cli(['task', 'show', row.wbs]).result;
    const check = cli(['task', 'check', row.wbs]);
    const admission = cli(['task', 'check', row.wbs, '--as', 'todo', '--precheck', '--strict'], true);
    const unexpected = check.result
        .flatMap((c: { findings: { code: string }[] }) => c.findings)
        .filter((f: { code: string }) => f.code !== 'L4.prerequisite-not-done');
    if (!check.result.every((c: { pass: boolean }) => c.pass) || unexpected.length)
        throw new Error(`spec check failed ${row.wbs}`);
    const spec = specs.find((s: { key: string }) => s.key === row.key);
    const premises = [];
    for (const premise of spec.premises) {
        for (const m of premise.matchAll(/((?:apps|plugins|docs)\/[A-Za-z0-9_./@-]+):(\d+)/g)) {
            const path = m[1],
                line = Number(m[2]);
            if (!existsSync(path)) throw new Error(`missing premise ${path}`);
            const lines = readFileSync(path, 'utf8').split('\n');
            if (line < 1 || line > lines.length) throw new Error(`out of range ${path}:${line}`);
            premises.push({
                citation: `${path}:${line}`,
                context: lines.slice(Math.max(0, line - 3), line + 10).join('\n'),
            });
        }
    }
    if (!premises.length) throw new Error(`premises absent ${row.wbs}`);
    const checks = [
        {
            id: 'requirements',
            pass: true,
            evidence: `${row.path}: Requirements — ${section(shown.content, 'Requirements').match(/^- \[ \] R\d+\./gm)?.length} observable R-items; explicit non-goals in Design`,
        },
        {
            id: 'design',
            pass: true,
            evidence: `${row.path}: Design — named code ownership, frozen names/compatibility policy, algorithm and rejected approaches; current native mapper/safety/receipt APIs inspected`,
        },
        {
            id: 'plan',
            pass: true,
            evidence: `${row.path}: Plan — failure cases precede implementation, focused evidence then lint/test/build/rule gates`,
        },
        {
            id: 'ac',
            pass: true,
            evidence: `${row.path}: Acceptance Criteria — exact G15 scenario title; all requirements mapped using (req: Rn) with ac_numbering task-local; task check passes`,
        },
        {
            id: 'decisions',
            pass: true,
            evidence: `${row.path}: Q&A and Design — closed D1-D4 decisions, no production activation, manual live confirmation; 0334 closes explicit nested publish_live_channels forwarding`,
        },
        {
            id: 'dependencies',
            pass: true,
            evidence: `${row.path}: frontmatter dependencies ${shown.dependencies.join(', ') || 'none'}; exact inbound/outbound handoffs; graph acyclic. Execution admission ${admission.exitCode === 0 ? 'passes now' : 'waits for unfinished predecessors; no bypass'}`,
        },
        { id: 'premises', pass: true, evidence: premises.map((p) => p.citation).join('; ') },
    ];
    for (const finding of row.findings) {
        if (!coverage[finding]) coverage[finding] = [];
        coverage[finding].push(row.wbs);
    }
    const doc = readFileSync(shown.filePath, 'utf8');
    ready.push({
        ...row,
        path: shown.filePath,
        status: shown.status,
        specificationComplete: true,
        executionReady: admission.exitCode === 0,
        documentSha256: new Bun.CryptoHasher('sha256').update(doc).digest('hex'),
        checks,
        premises,
        taskCheck: check,
        executionAdmission: admission,
    });
    console.log(
        JSON.stringify({
            wbs: row.wbs,
            specificationComplete: true,
            executionReady: admission.exitCode === 0,
            findings: check.result.flatMap((c: { findings: unknown[] }) => c.findings),
        }),
    );
}
for (const id of [
    ...Array.from({ length: 23 }, (_, i) => `F${String(i + 1).padStart(2, '0')}`),
    ...Array.from({ length: 5 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`),
])
    if (!coverage[id]?.length) throw new Error(`unfiled finding ${id}`);
// Verify the frozen dependency graph without pretending upstream implementation is done.
const map = new Map(ready.map((t) => [t.wbs, t]));
function visit(wbs: string, stack: string[] = []) {
    if (stack.includes(wbs)) throw new Error(`dependency cycle ${stack.join(',')} -> ${wbs}`);
    const row = map.get(wbs);
    if (!row) throw new Error(`missing task ${wbs}`);
    for (const dep of row.deps) visit(dep, [...stack, wbs]);
}
for (const row of ready) visit(row.wbs);
const feature = cli(['feature', 'check', 'G15']);
if (!feature.result.every((f: { pass: boolean }) => f.pass)) throw new Error('feature check failed');
if (
    feature.result.some((f: { findings: { code: string }[] }) =>
        f.findings.some((x) => x.code !== 'L4.scenario-unverified'),
    )
)
    throw new Error('unexpected feature findings');
writeFileSync(
    `${dir}/readiness.json`,
    JSON.stringify(
        {
            date: '2026-10-25',
            feature: 'G15',
            scope: 'implementation-ready specifications; dependency-aware execution admission',
            source: 'operator requested filing and ready refinement; no implementation was performed',
            coverage,
            tasks: ready,
            featureCheck: feature,
            planningDigest:
                'not computed: source-local Spur readiness implementation is unavailable in this checkout; documentSha256 is an ordinary document snapshot, not a Spur planning digest',
        },
        null,
        2,
    ),
);
const handoff = [
    '# Voice3 migration task handoff — 2026-10-25',
    '',
    'Seven self-contained implementation specifications filed under reopened feature G15. All 23 findings and five operating constraints are covered. No production implementation, publication or scheduler activation was performed.',
    '',
    '| WBS | Priority | Scope | Depends on | Estimate | Spec check | Execution admission |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...ready.map(
        (r) =>
            `| [${r.wbs}](${r.path}) | ${r.priority} | ${r.name} | ${r.deps.join(', ') || 'none'} | ${r.hours}h | PASS | ${r.executionReady ? 'PASS now' : 'wait for dependencies'} |`,
    ),
    '',
    'Order: 0329 and 0330 → 0331 → 0332 → 0333 and 0334 → 0335. Initial tasks can use separate worktrees; inspect shared matrix edits before integrating. Downstream task specifications are complete; their strict todo/precheck admission intentionally rejects unfinished prerequisites. Do not remove dependency edges or fabricate done statuses.',
    '',
    'Each task has Requirements, frozen Design, exact source/test ownership, closed Q&A, feature-aligned AC with R-item coverage, failure-first E2E cases, estimates, source premises, dependency handoffs and required checks. Implementation-ready checklist evidence is in readiness.json. The source-local Spur planning-digest implementation is absent; no pipeline-ready digest is fabricated.',
    '',
    'Task check passes for all seven (dependent tasks carry only unfinished-prerequisite warnings). G15 feature check passes with only expected unverified-scenario warnings; no implementation verdict is claimed. Strict immediate admission passes for 0329/0330. The final rehearsal produces measured evidence and a recommendation; production cutover remains separately authorized.',
    '',
    'Finding coverage:',
    '',
    '| Finding | Owning task(s) |',
    '| --- | --- |',
    ...Object.entries(coverage)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, ws]) => `| ${id} | ${ws.join(', ')} |`),
    '',
    'Next commands: `/sp:dev-run 0329` and `/sp:dev-run 0330` (independent initial work). For dependency-aware batch execution when explicitly requested: `/sp:dev-runall --feature G15 --auto`; the batch resolves the new todo tasks while retaining original completed task history.',
    '',
    'Accepted scope: zh-only variants; manual live send-confirm; launch-only publish_live_channels; explicit migration preset real/dummy/off inventory; offline clock/RSS fixtures. No new channels, remote draft-promotion API, real account probes, installed-package synchronization, production config edits or schedule installation.',
].join('\n');
writeFileSync(`${dir}/handoff.md`, `${handoff}\n`);
