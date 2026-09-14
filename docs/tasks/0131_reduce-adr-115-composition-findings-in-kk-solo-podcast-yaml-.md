---
schema_version: 1
name: Reduce ADR-115 composition findings in kk-solo-podcast.yaml (4 shell actions + 1 agent.run prompt over threshold)
status: todo
template: issue
created_at: 2026-09-14T22:16:12.045Z
updated_at: "2026-09-14T22:16:18.361Z"
feature_id: F8

---

## 0131. Reduce ADR-115 composition findings in kk-solo-podcast.yaml (4 shell actions + 1 agent.run prompt over threshold)

### Background

`plugins/kk/workflows/kk-solo-podcast.yaml` fails the ADR-115 composition gate on content measures once its actions are schema-valid. Surfaced by task 0130 (the re-indent that made `options.command` well-formed); the findings were previously unreachable because the 8 `kind: shell` actions parsed with `options: null` and were skipped by the composition analyzer. Pre-existing content properties, not a 0130 regression — the untouched canonical mirror `plugins/kk/workflows/kk-itc.yaml` also exits 1 on its own composition error.

Repro: `spur workflow validate plugins/kk/workflows/kk-solo-podcast.yaml --json` → `valid: true` but 5 error-level `composition.findings` (plus 5 warns), so exit 1.

### Requirements

- [ ] R1. `spur workflow validate plugins/kk/workflows/kk-solo-podcast.yaml --json` exits 0 — zero error-level `composition.findings` (warn-level findings may remain).
- [ ] R2. Each of the 4 over-threshold shell actions (prepare 29, script-validate 27, wrap-docs 27, duration-check 21 logical commands; error above 10) is reduced to the threshold by moving its logic to a named owner (a `kk` subcommand or a script under `plugins/kk/scripts/`), not by compressing command text.
- [ ] R3. The `script-write` `agent.run` prompt (currently 1458 chars, 1000-char cap) is pinned to a slash command or a bounded script input.
- [ ] R4. No observable behavior change: the solo-podcast pipeline performs the same stages with the same artifacts (the task 0130-equivalence method — parsed command/prompt equivalence or an explicit equivalence argument per moved action).

### Acceptance Criteria

<!-- Given/When/Then regression scenario or checklist proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. (R2) Extract `prepare`'s 29 logical commands into a named owner; verify with `spur workflow validate … --json` that the `prepare:onEnter:0` finding is gone.
2. (R2) Repeat for `script-validate`, `wrap-docs`, and `duration-check` (the last two already resolve sibling scripts by path — decide whether the resolution loop itself is the owner boundary).
3. (R3) Pin the `script-write` `agent.run` prompt to a slash command or bounded input reference.
4. (R4) Prove equivalence: same artifacts, same stage order, same `vars`; run the repo suite plus the `apps/cli/tests/kk-solo-podcast-workflow.test.ts` string assertions.
5. Check the same measures for `kk-itc.yaml` and the other ADR-115-erroring workflows (`docs-pipeline`, `feature-dev`, `idea-pipeline`, `pr-review`, `task-pipeline`, `wayfinder-resolution`, `wrapup-pipeline`) — if the debt is systemic, propose one follow-up rather than eight.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
