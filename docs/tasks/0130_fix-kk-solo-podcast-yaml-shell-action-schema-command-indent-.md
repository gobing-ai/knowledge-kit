---
schema_version: 1
name: "Fix kk-solo-podcast.yaml shell-action schema (command: indent + options: null)"
status: todo
template: issue
created_at: 2026-09-14T21:55:27.893Z
updated_at: "2026-09-14T21:55:58.666Z"
feature_id: F8

---

## 0130. Fix kk-solo-podcast.yaml shell-action schema (command: indent + options: null)

### Background

Captured from the creation title: "Fix kk-solo-podcast.yaml shell-action schema (command: indent + options: null)".

### Requirements

- R1: `spur workflow validate plugins/kk/workflows/kk-solo-podcast.yaml --json` exits 0 with valid:true, errorCount 0.
- R2: All 8 shell actions (states 0,2,4,6,8,9,10,11 onEnter) use the canonical schema: `options` is an object (not null) and there is no unknown `command` field (the executable belongs in the action shape the validator accepts — `sh`/`run`-style, mirroring kk-itc.yaml shell actions).
- R3: No behavioral change: the same 8 actions execute the same shell commands in the same states; string-assertion tests in kk-solo-podcast-workflow.test.ts stay green, and every command string in the YAML survives the move byte-identical.
- R4: Provenance note recorded: defect pre-exists commit fcf4fda on main (identical failure in the untouched main checkout); discovered during task 0128 verify.

### Acceptance Criteria

```gherkin
@core
Scenario: kk-solo-podcast validates and can load
  Given the kk-solo-podcast workflow YAML on this branch
  When the workflow is validated with the spur workflow validator
  Then validation exits 0 with valid:true
  And no shell action carries options:null or an unknown "command" field
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

- Mechanism: indentation/type repair only — `command:` keys at 8-space indent are moved into the position the validator expects (or folded into the accepted action field), and `options:` set to `{}` (or the correct object shape) instead of null.
- Mirror kk-itc.yaml's shell-action shape for all 8 states; do not redesign the workflow graph.
- Guard: `spur workflow validate plugins/kk/workflows/kk-solo-podcast.yaml --json` joins the repo gate evidence for this task.

### Plan

1. Diff the 8 broken onEnter blocks against kk-itc.yaml shell actions; derive the canonical shape.
2. Apply the indent/type repair; validate exit 0.
3. Run kk-solo-podcast-workflow.test.ts + workflow-run-command.test.ts; full gate.
4. Optional stretch (only if trivial after the fix): dry-run the solo workflow with --fixture-style vars to prove the machine loads. HITL/live TTS stays out of scope.

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
