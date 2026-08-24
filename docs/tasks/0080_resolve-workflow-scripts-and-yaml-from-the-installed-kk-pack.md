---
schema_version: 1
name: "Resolve workflow scripts and YAML from the installed kk package root"
status: done
template: feature-impl
created_at: 2026-08-24T06:31:42.639Z
updated_at: "2026-08-24T07:05:23.086Z"
feature_id: F8
---

## 0080. Resolve workflow scripts and YAML from the installed kk package root

### Background

<!-- Why this task exists: the problem, motivation, and context. Self-contained — readable without the parent. -->

### Requirements
- [x] R1. Resolve `validate_script` / `wrap_script` in `kk-solo-podcast.yaml` via a fallback chain — explicit var → `$KK_WORKFLOWS_DIR` → kk package root (`command -v kk` + symlink walk) → `$HOME/.config/kk/workflows` — each step existence-checked, fail-loud naming all roots.
- [x] R2. `/workflow-run` runs the resolved YAML in place from any cwd: user override → `KK_WORKFLOWS_SOURCE` → package root → repo checkout; no auto-copy; `--force` refreshes the override; sidecar copy loop removed.
- [x] R3. Sync `docs/04_DESIGN.md` §7, `docs/help/solo-podcast-workflow.md`, `docs/design/kk-solo-podcast.md` (D7/D8) in the same commit.
- [x] R4. `bun run lint` + `bun run test` green; yamllint clean with repo config.

**Non-goals:** changing `voice-gen` or the validator contract; new kk CLI nouns (ADR-011).
### Acceptance Criteria
```gherkin
Feature: Run-anywhere workflow and script resolution

  Scenario: Sidecars resolve from the installed package root
    Given no user override and no KK_WORKFLOWS_DIR
    When the workflow validates or wraps a VoiceScript
    Then the sidecar resolves from the kk package root via command -v kk
    And a missing sidecar fails loud naming every searched root

  Scenario: Workflow YAML runs in place from any cwd
    Given no user override under workflows_dir
    When /workflow-run resolves the workflow YAML
    Then the first hit of override, KK_WORKFLOWS_SOURCE, package root, checkout is run in place
    And nothing is copied on the happy path
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
- `plugins/kk/workflows/kk-solo-podcast.yaml:167` — R1: `validate_script` chain rewritten with `command -v kk` symlink-walk package-root resolution (same pattern at `:209` for `wrap_script`).
- `plugins/kk/commands/workflow-run.md:90` — R2: §3 rewritten to in-place resolution (override → KK_WORKFLOWS_SOURCE → package root → checkout); sidecar copy loop removed; frontmatter description updated.
- `.yamllint:1` — NEW: repo-level yamllint config (line-length + document-start off); 3 pre-existing guard indentation errors fixed in the YAML.
- `apps/cli/tests/workflow-run-command.test.ts:93` + `apps/cli/tests/kk-solo-podcast-workflow.test.ts:121` — invariants updated to the new semantics.
- `docs/04_DESIGN.md:409` §7, `docs/help/solo-podcast-workflow.md:13`, `docs/design/kk-solo-podcast.md:30` — R3 doc sync.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 (package-root resolution in YAML sidecar chains) | MET | `plugins/kk/workflows/kk-solo-podcast.yaml` — both `validate_script` and `wrap_script` chains: explicit var → `$KK_WORKFLOWS_DIR` → `$pkg/plugins/kk/workflows/` (via `command -v kk` + symlink walk) → `$HOME/.config/kk/workflows`, each step existence-checked, fail-loud names all roots |
| R2 (workflow YAML runs in place from any cwd) | MET | `plugins/kk/commands/workflow-run.md` §3 — resolution order: user override → `KK_WORKFLOWS_SOURCE` → `$pkg` package root → repo checkout; no auto-copy; `--force` refreshes the override; sidecar copy loop removed |
| R3 (docs synced same commit) | MET | `docs/04_DESIGN.md` §7 rewritten (run-anywhere resolution); `docs/help/solo-podcast-workflow.md` two-homes + tables; `docs/design/kk-solo-podcast.md` D7/D8 + shell snippets |
| R4 (gates green) | MET | command: `bun run lint` → all workspaces exit 0; `bun run test` → 470 pass / 0 fail; `yamllint plugins/` → clean with new repo `.yamllint` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Sidecars resolve from package root outside a checkout | MET | test | `kk-solo-podcast-workflow.test.ts` — runtime-paths invariant updated: bare `plugins/kk/workflows` refs forbidden except under `$pkg/`; `command -v kk` asserted in YAML |
| workflow-run resolves in place, no happy-path copy | MET | test | `workflow-run-command.test.ts` — asserts `$pkg/plugins/kk/workflows/$NAME.yaml`, `command -v kk`, `in place`, absence of `cp "$src" "$dest"` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Finding | Severity | Disposition |
| --- | --- | --- | --- |
| P1 | None | — | — |
| P2 | pi-lens ran yamllint with default 80-char rules (no repo config existed) | — | fixed: repo-root `.yamllint` added (line-length + document-start off, matching repo conventions); 3 pre-existing guard indentation errors also fixed |
| P3 | F8 feature AC is placeholder; verdict warns scenario-unverified | low | F8 AC to be authored at feature close |
| P4 | None | — | — |
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-24T06:58:54.885Z todo → wip (system)
- 2026-08-24T07:04:02.580Z wip → testing (system)
- 2026-08-24T07:05:23.086Z testing → done (system)
