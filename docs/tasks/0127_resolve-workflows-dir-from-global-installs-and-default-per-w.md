---
schema_version: 1
name: Resolve workflows_dir from global installs and default per-workflow workspaces in workflow-run
status: todo
template: feature-impl
created_at: 2026-09-14T17:55:18.370Z
updated_at: "2026-09-14T17:59:45.192Z"
feature_id: F8
priority: P2
tags:
  - kk
  - workflow-run
  - config

---

## 0127. Resolve workflows_dir from global installs and default per-workflow workspaces in workflow-run

### Background

Feature F8 extension (docs/features/F8_run-anywhere-workflow-and-script-resolution.md). The only runtime reader of `workflows_dir`/`works_dir` is `plugins/kk/commands/workflow-run.md` (the shell procedure behind `/kk:workflow-run` and the kk-workflow-run skill). Today `workflows_dir` falls back from config to KK_WORKFLOWS_SOURCE to a `command -v kk` package-root walk, and each profile computes work_dir inconsistently (storm: `$works_dir/<topic-id>`, itc: cwd-relative `./<kebab>`, solo-podcast/daily-voice: `$works_dir/kk-solo-podcast/<date>`). Operators who installed kk globally but never wrote a config get a broken or cwd-polluting experience.

Covers feature F8 scenarios: R1 (Empty or missing workflows_dir falls back to global-install locations), R2 (A corrupt config.yaml still fails loud), R3 (Each workflow defaults its work_dir under works_dir/<workflow-name>/), R4 (kk-itc no longer writes into the caller's cwd).

### Requirements

- [ ] R1. When `workflows_dir` in `~/.config/kk/config.yaml` is absent, empty, unexpanded, or not a readable directory, the §3 source-resolution chain tries `$(dirname $(bun pm bin -g))/install/global/node_modules/@gobing-ai/knowledge-kit/plugins/kk/workflows` then `$(dirname $(npm root -g))/node_modules/@gobing-ai/knowledge-kit/plugins/kk/workflows` — inserted into the candidate-dir loop after `$KK_WORKFLOWS_SOURCE` and before the existing `command -v kk` package-root walk and checkout default; first readable hit wins.
- [ ] R2. Each new probe is guarded (`command -v bun` / `command -v npm` plus `test -d`) so a missing package manager never breaks the chain.
- [ ] R3. A corrupt (unparseable) config.yaml still exits 1 — no fallback masks it.
- [ ] R4. Per-workflow default work_dir when no explicit `--dir`/`dir` is given: kk-storm-research → `$works_dir/kk-storm-research/<topic-id>`; kk-itc → `$works_dir/kk-itc/<kebab>`; kk-solo-podcast → `$works_dir/kk-solo-podcast/<date>`; kk-daily-ai-voice → `$works_dir/kk-daily-ai-voice/<date>`. The shared §4 solo/daily formula splits into per-profile defaults; §1's stale `--dir` default prose is corrected to match. Explicit `--dir` still wins; kk-itc never writes into the caller's cwd.
- [ ] R5. `apps/cli/tests/workflow-run-command.test.ts` (already asserts `workflows_dir:` and `KK_WORKFLOWS_SOURCE` lines) asserts the new chain entries and all four per-profile defaults.

### Acceptance Criteria

```gherkin
Scenario: Empty or missing workflows_dir falls back to global-install locations
  Given a config.yaml with workflows_dir absent or empty and no KK_WORKFLOWS_SOURCE
  When /workflow-run resolves a workflow YAML
  Then the bun global path is tried, then the npm global path, then the package-root walk

Scenario: A corrupt config.yaml still fails loud
  Given ~/.config/kk/config.yaml is not parseable YAML
  When /workflow-run runs
  Then it exits 1 with the config error and no fallback masks it

Scenario: Each workflow defaults its work_dir under works_dir/<workflow-name>/
  Given works_dir resolves and no explicit --dir
  When a profile's workspace is computed
  Then storm uses $works_dir/kk-storm-research/<topic-id>
  And itc uses $works_dir/kk-itc/<kebab>
  And solo-podcast uses $works_dir/kk-solo-podcast/<date>
  And daily-ai-voice uses $works_dir/kk-daily-ai-voice/<date>

Scenario: kk-itc no longer writes into the caller's cwd
  Given no --dir for the kk-itc profile run from /tmp
  When the workspace is computed
  Then the work_dir is $works_dir/kk-itc/<kebab>, never ./<kebab>
```

Task-local checks: a missing `bun` or `npm` binary never breaks the chain (guarded probes); explicit `--dir` wins over every default; `apps/cli/tests/workflow-run-command.test.ts` asserts both global-install fallbacks and all four per-profile defaults.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: extend the resolution prose and shell blocks inside `plugins/kk/commands/workflow-run.md` only (approach A chosen at idea-eval — no new resolver script, no TS). WHY: the command is the sole invoker that computes these paths; centralizing there keeps the diff surgical and the precedence flag > env > config > global-install > package-root > checkout readable in one place. Chain insert position: in the §3 `for d in` loop, between `$KK_WORKFLOWS_SOURCE` and `${pkg:+$pkg/plugins/kk/workflows}` — global installs are the common no-config case; the walk stays as the dev-checkout fallback. §4: replace the shared `work_dir="${DIR:-$works_dir/kk-solo-podcast/$date}"` block with per-profile defaults; storm gains the `kk-storm-research/` segment, itc moves off `./$kebab` to `$works_dir/kk-itc/$kebab` (empty kebab still exits 1), solo/daily keep their `<date>` shape in their own namespaces. Invariants: corrupt config exits 1 before any probe runs; explicit `--dir` beats every default; no behavior change when workflows_dir is valid. Skipped: shared `scripts/kk-runtime-resolve.sh` (approach B) — add when a second invoker appears; TS `kk config resolve` (approach C) — rejected, no TS consumer exists.

### Plan

1. Read `plugins/kk/commands/workflow-run.md` §1 (line ~38 arg defaults), §3 (resolution loop ~95–111), §4 (workspace computation ~133–167), §5.
2. Add the two guarded global-install probes to the §3 candidate list; document the full precedence in the surrounding prose.
3. Rewrite §4 per-profile work_dir defaults per R4 and fix the §1 `--dir` default line.
4. Update `apps/cli/tests/workflow-run-command.test.ts` to assert the new chain lines and the four defaults.
5. `bun run lint` + targeted `bun test apps/cli/tests/workflow-run-command.test.ts`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
