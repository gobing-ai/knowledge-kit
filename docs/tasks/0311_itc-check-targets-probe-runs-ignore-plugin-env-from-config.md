---
schema_version: 1
name: "itc check-targets: probe runs ignore plugin env from config"
status: todo
template: issue
created_at: 2026-10-17T07:36:05.505Z
updated_at: "2026-10-17T07:36:42.360Z"
feature_id: G21

---

## 0311. itc check-targets: probe runs ignore plugin env from config

### Background

Dogfood run kk-itc-20261016T224508-18167: `itc-check-targets` refused substack-pub with "substack publication URL is required: set SUBSTACK_PUBLICATION_URL" even after the operator set it under `plugins.publishings.substack-pub.env` in `~/.config/kk/config.yaml`. The probe runner in `itcCheckTargets` (`apps/cli/src/itc-publish.ts`) spawns `plugin.check` with `env: process.env` only — the config's plugin env entries, which ARE injected for real plugin exec, never reach the probe. The dogfood had to `export SUBSTACK_PUBLICATION_URL` manually.

## Fix direction

Resolve plugin env the same way the executor invoke path does (flag > env > config > compiled default) and pass it to the probe's `executor.run` env. Do not hand-roll a second config reader — reuse the existing injection seam. Credential handling: probe env must not leak into logs or receipts.

## Evidence

- Probe spawn: `apps/cli/src/itc-publish.ts` (itcCheckTargets, `env: process.env as Record<string, string>`)
- Config convention documented in `~/.config/kk/config.yaml` header: "each entry is injected into that plugin's process environment at exec time"
- Probe: `plugins/publishings/substack-pub/src/profile-check.ts` requires SUBSTACK_PUBLICATION_URL

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Include repro/expected behavior if it helps traceability. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

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
