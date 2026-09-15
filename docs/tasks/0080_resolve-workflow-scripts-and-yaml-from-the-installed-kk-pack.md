---
schema_version: 1
name: "Resolve workflow scripts and YAML from the installed kk package root"
status: done
template: feature-impl
created_at: 2026-08-24T06:31:42.639Z
updated_at: "2026-09-15T18:32:32.562Z"
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
| R1 | MET | `plugins/kk/scripts/kk-workflow-stages.ts:96-121` — sidecar fallback chain (explicit var → `$KK_WORKFLOWS_DIR` → package copy via `command -v kk` walk → `$HOME/.config/kk/workflows`), fail-loud naming every root at :121. Chain relocated from the YAML into the stage runner by 0130/0131 — documented at `plugins/kk/workflows/kk-solo-podcast.yaml:142` ("override chain preserved inside the stage runner"); goal-equivalent CHANGED anchor, re-read this run |
| R2 | MET | `plugins/kk/commands/workflow-run.md:85` — "runs **in place** — no copy on the happy path"; resolution order override → `KK_WORKFLOWS_SOURCE` → bun/npm global → package root → checkout at :114-139; fail-loud naming roots at :131/:139 |
| R3 | MET | `docs/04_DESIGN.md:309,:562-573` run-anywhere resolution; `docs/help/solo-podcast-workflow.md`; `docs/design/kk-solo-podcast.md` (kept current by 0129) |
| R4 | MET | command (this run): `bun run lint` exit 0 all workspaces; `bun run test` 1024 pass / 0 fail / 65 files; all 6 workflow YAMLs `spur workflow validate` exit 0 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Sidecars resolve from the installed package root | MET | command | `command -v kk` → `/Users/robin/.bun/bin/kk`; chain + fail-loud at `plugins/kk/scripts/kk-workflow-stages.ts:96-121` (re-read this run) |
| Scenario: Workflow YAML runs in place from any cwd | MET | test | `apps/cli/tests/workflow-run-command.test.ts` green in this run's suite (1024 pass / 0 fail); in-place contract `plugins/kk/commands/workflow-run.md:85` |
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
