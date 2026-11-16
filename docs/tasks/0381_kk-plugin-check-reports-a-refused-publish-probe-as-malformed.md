---
schema_version: 1
name: kk plugin check reports a refused publish probe as malformed output instead of the refusal detail
status: backlog
template: standard
created_at: 2026-11-16T01:39:53.909Z
updated_at: "2026-11-16T01:40:13.388Z"

---

## 0381. kk plugin check reports a refused publish probe as malformed output instead of the refusal detail

### Background

Observed on the production host 2026-11-15 while diagnosing the `shipinhao-pub` daily-run refusal.

With shipinhao's cached session expired:

```
$ kk plugin check shipinhao-pub
  • shipinhao-pub [publish]: error — probe exit 1 (malformed probe output)

$ bun plugins/publishings/shipinhao-pub/src/profile-check.ts check
{"status":"refused","profileDir":"...","detail":"headed shipinhao readiness refused:
 Authentication was not confirmed within 30000ms. The profile's site session has likely expired ..."}
```

The probe DOES print a well-formed `{"status":"refused", ...}` and exits 1, which
`apps/cli/src/invoke.ts:307` is explicitly written to accept (`status === 'refused' && exitCode === 1`).
Yet the parent reports `status === undefined` and falls through to `invoke.ts:315`
(`probe exit ${exitCode} (malformed probe output)`).

Impact: the daily run's session-preflight told the operator "malformed output" for a problem whose
real cause — an expired login — has a one-command fix. That mislabel cost a diagnosis detour here and
is the reason it read as a code defect rather than a session expiry.

`apps/cli/src/commands/plugin.ts:200-210` already carries a note about this exact string appearing when
the parent's deadline raced the probe's own 30 s auth wait, and the parent timeout was raised to 60 s
for it; this occurrence is not that race (the parent waited the full probe duration and the probe
printed its verdict), so the remaining cause is in how `spawnPluginProbe` captures or classifies the
child's stdout.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
