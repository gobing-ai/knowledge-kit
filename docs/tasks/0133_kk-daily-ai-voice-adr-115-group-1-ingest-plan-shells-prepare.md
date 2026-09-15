---
schema_version: 1
name: "kk-daily-ai-voice ADR-115 group 1: ingest/plan shells (prepare, collect, plan, quality-control-content, plan-translate)"
status: todo
template: issue
created_at: 2026-09-14T23:36:55.942Z
updated_at: "2026-09-15T01:01:56.162Z"
feature_id: F8
parent_wbs: "0132"

---

## 0133. kk-daily-ai-voice ADR-115 group 1: ingest/plan shells (prepare, collect, plan, quality-control-content, plan-translate)

### Background

Sub-task of **0132** (parent). Group 1 of 4 from the kk-daily-ai-voice decomposition.

`plugins/kk/workflows/kk-daily-ai-voice.yaml` is the live 06:00 scheduled pipeline
(`.spur/config.yaml` → `kk-daily-ai-voice` end-to-end). It has 21 error-level ADR-115 composition
findings; 0132 splits them into four ordered groups so the refactor lands in reviewable slices
instead of one blind pass over a production workflow that has no end-to-end test (the static suite
`apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` is the only automated coverage).

Measured 2026-09-14 with `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice.yaml --json`
(error tier: shell action > 10 logical commands or > 800 chars; agent.run input > 1000 chars):

| Action | Measure |
| --- | --- |
| `prepare:onEnter:0` | 15 logical commands |
| `collect:onEnter:1` | 12 logical commands |
| `plan:onEnter:0` | 21 logical commands |
| `quality-control-content:onEnter:0` | 11 logical commands |
| `plan-translate:onEnter:0` | `agent.run` input 1258 chars |

Scope: the ingest/plan half of the pipeline (steps 1-5). Same owner pattern task 0132 established:
add `daily-ai-voice` verbs to `plugins/kk/scripts/kk-workflow-stages.ts` (or to a
`kk-daily-ai-voice-stages.ts` runner if the group warrants its own file), reduce each YAML action to
the shared package-root prelude plus one `bun "$st" <verb>` call, and port the body
message-for-message.

**Owner-shape decision to pin while resolving this group (from the 0132 run).** The 0132 Q&A entry
and the Design amendment record the reversal: use the shared `plugins/kk/scripts/kk-workflow-stages.ts`
runner with per-stage verbs when the bodies share a core (as `prepare-itc`/`prepare-solo` did), and give
a stage its own code path only when the payload genuinely differs (as `prepare-storm` did). Do not open
a fourth script file without recording why the shared runner could not carry the verb.

### Requirements

<!-- R-numbered expectations for the fix. Include repro/expected behavior if it helps traceability. -->

### Acceptance Criteria

<!-- Given/When/Then regression scenario or checklist proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

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
