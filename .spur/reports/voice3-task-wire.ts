import { readFileSync, writeFileSync } from 'node:fs';

const root = '.spur/reports/voice3-task-plan';
const specs = JSON.parse(readFileSync(`${root}/specs.json`, 'utf8'));
const created = JSON.parse(readFileSync(`${root}/create-result.json`, 'utf8'));
if (created.wbs.length !== specs.length) throw new Error('batch mapping mismatch');
const mapping = Object.fromEntries(specs.map((s: { key: string }, i: number) => [s.key, created.wbs[i]]));
function cli(args: string[]) {
    const out = Bun.spawnSync(['spur', ...args, '--json'], { stdout: 'pipe', stderr: 'pipe' });
    const stdout = out.stdout.toString();
    if (out.exitCode !== 0) throw new Error(`${args.join(' ')}: ${out.stderr.toString()} ${stdout}`);
    return JSON.parse(stdout);
}
function update(wbs: string, section: string, text: string) {
    const file = `${root}/${wbs}-${section.replaceAll(/[^A-Za-z]/g, '')}.md`;
    writeFileSync(file, text);
    return cli(['task', 'update', wbs, '--section', section, '--from-file', file]);
}
const taskRows = [];
for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const wbs = created.wbs[i];
    const deps = s.deps.map((d: string) => mapping[d]);
    if (deps.length) cli(['task', 'deps', wbs, 'set', ...deps]);
    cli(['task', 'update', wbs, '--ac-numbering', 'task-local']);
    let design = s.batch.design.replace(
        '**Dependencies:** ' +
            (s.deps.length ? s.deps.join(', ') : 'none; this task may start immediately') +
            '. Exact WBS edges and required handoffs are recorded by the filing manifest and will be substituted below before delegation.',
        `**Dependencies:** ${deps.length ? deps.join(', ') : 'none; runnable immediately'}. Dependency edges are persisted in frontmatter.\n\n**Inbound handoff:** ${s.deps.length ? s.deps.map((d: string) => `${mapping[d]} — ${specs.find((v: { key: string }) => v.key === d).scenario}`).join('; ') : 'Current source contracts and audit reproductions; no upstream implementation prerequisite'}.\n\n**Outbound handoff:** ${
            specs
                .filter((v: { deps: string[] }) => v.deps.includes(s.key))
                .map((v: { key: string; scenario: string }) => `${mapping[v.key]} — ${v.scenario}`)
                .join('; ') ||
            'Measured migration-readiness recommendation and prepared operator cutover/rollback artifacts'
        }.\n\n**Execution scope:** This task specifies local implementation when delegated. The filing itself performed planning only. Shared-file tasks must respect these edges; independent initial tasks may run in separate worktrees.\n\n**Batch order:** 0329 and 0330 may start independently; 0331 follows both; 0332 follows 0331; 0333 and 0334 follow 0332; 0335 follows both. Transitive prerequisites remain binding.`,
    );
    design = design.replaceAll('<wbs>', wbs);
    update(wbs, 'Design', design);
    const qa = `<!-- qa:replace -->\nClosed decisions (2026-10-25):\n- Scope: implement the local correction described here; production publishing, scheduler installation and installed-package syncing remain separate operator actions.\n- Compatibility: preserve voice2 and kk-itc behavior unless this task explicitly provides a voice3-only opt-in.\n- Decisions D1-D4 remain accepted; Chinese-only parity is intentional and manual live confirmation is retained. Unsupported operations stay explicit dummy/off, never implicit live.\n- Dependencies: ${deps.length ? deps.join(', ') : 'none'}; handoff contracts and exact owned paths are in Design. No unresolved architecture or scope question remains for the implementer.\n- Source audit findings owned here: ${s.findings.join(', ')}. Failure cases must precede production edits; evidence uses isolated local fixtures.\n`;
    update(wbs, 'Q&A', qa);
    const refs = `- Parent feature: G15, docs/features/G15_daily-ai-voice-v3-split-generate-and-publish-preset-driven-channel-matrix.md.\n- Source audit: .spur/reports/voice3-migration-review-2026-10-25.md; all owned findings and current-code premises are embedded in Background so this task is self-contained.\n- Authority: docs/00_ADR.md:957 (ADR-022), docs/00_ADR.md:1223 (ADR-031), docs/design/kk-daily-ai-voice3.md:227 (accepted operator decisions), docs/99_PROJECT_CONSTITUTION.md:160 (surface/status synchronization).\n- Dependencies: ${deps.join(', ') || 'none'}.\n- Batch map and readiness evidence: .spur/reports/voice3-task-plan/handoff.md and readiness.json.\n- Code/test targets and observable failure matrix: Design.\n`;
    update(wbs, 'References', refs);
    const check = cli(['task', 'check', wbs]);
    if (
        check.some((c: { findings: Array<{ code: string }> }) =>
            c.findings.some((f) => f.code !== 'L4.prerequisite-not-done'),
        )
    )
        throw new Error(`unexpected task findings ${wbs}: ${JSON.stringify(check)}`);
    const admissionResult = Bun.spawnSync(
        ['spur', 'task', 'check', wbs, '--as', 'todo', '--precheck', '--strict', '--json'],
        { stdout: 'pipe', stderr: 'pipe' },
    );
    const admission = JSON.parse(admissionResult.stdout.toString());
    if (
        admission.some((c: { findings: Array<{ code: string }> }) =>
            c.findings.some((f) => f.code !== 'L4.prerequisite-not-done'),
        )
    )
        throw new Error(`unexpected admission findings ${wbs}: ${JSON.stringify(admission)}`);
    writeFileSync(
        `${root}/${wbs}-admission.json`,
        JSON.stringify({ exitCode: admissionResult.exitCode, result: admission }, null, 2),
    );
    writeFileSync(`${root}/${wbs}-check.json`, JSON.stringify(check, null, 2));
    const shown = cli(['task', 'show', wbs]);
    taskRows.push({
        wbs,
        key: s.key,
        name: s.name,
        priority: s.priority,
        hours: s.hours,
        deps,
        findings: s.findings,
        path: shown.filePath,
        status: shown.status,
        check,
        admission,
    });
    console.log(
        JSON.stringify({ wbs, status: shown.status, pass: check.every((c: { pass: boolean }) => c.pass), deps }),
    );
}
writeFileSync(`${root}/tasks.json`, JSON.stringify(taskRows, null, 2));
