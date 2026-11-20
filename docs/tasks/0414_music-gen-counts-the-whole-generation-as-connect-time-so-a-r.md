---
schema_version: 1
name: music-gen counts the whole generation as connect time, so a real take reads as an unreachable instance
status: todo
template: issue
created_at: 2026-11-20T18:04:18.073Z
updated_at: "2026-11-20T18:04:18.285Z"
feature_id: D8

---

## 0414. music-gen counts the whole generation as connect time, so a real take reads as an unreachable instance

### Background

Captured from the creation title: "music-gen counts the whole generation as connect time, so a real take reads as an unreachable instance".

### Requirements

- [ ] R1. The connect phase is decided by the connection/TTFB probe, not by waiting for the instance's full synchronous response, so a real 40 s take is never classified `connect` and never retried as unreachable.
- [ ] R2. A regression test covers a slow body with a healthy connection: the send must be treated as dispatched (no retry, no 'nothing was billed' claim) and must surface the instance's own outcome.
- [ ] R3. The 5 s default stays the connect bound for a genuinely dead host.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. [ ] Reproduce against the live instance: `POST /api/lyria/generate` answers only after the take, so `attempt()`'s connect timer fires at 5 s inside `fetch()` and the run reports `... is unreachable ... nothing was billed` (0404, run 91b0aa4f).
2. [ ] Split the phase: probe reachability (a cheap GET such as `/api/settings/status`, or a TCP/TLS connect) under `connectTimeoutMs`, then run the paid POST under `timeoutMs` alone.
3. [ ] Pin it in `plugins/generations/music-gen/tests/` with a fake fetch whose headers arrive after the connect bound.

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
