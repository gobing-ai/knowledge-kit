---
schema_version: 1
name: "kk-itc: resume seam for failed DAG publish runs"
status: todo
template: issue
created_at: 2026-10-17T07:36:05.256Z
updated_at: "2026-10-17T07:36:25.922Z"
feature_id: G21

---

## 0310. kk-itc: resume seam for failed DAG publish runs

### Background

Dogfood run kk-itc-20261016T224508-18167 failed at `check-targets` (infoq stale profile lock). With the run in `failed`, there was no way to re-enter the DAG: `spur workflow continue` only resumes paused/interrupted runs, and `spur workflow run --from <node>` requires the node declared `startable: true` — no node in `plugins/kk/workflows/kk-itc.yaml` declares it. The remaining nodes were driven manually via `kk stage run` (itc-check-targets → itc-send-targets → --retry → itc-reconcile-receipts → itc-export-seo → itc-report-summary), which bypasses the engine's edge/condition bookkeeping.

## Fix direction

Declare `startable: true` on the post-authoring entry node(s) of kk-itc.yaml (at minimum `check-targets`; consider `materialize-plan`) so a failed publish tail can be re-entered with `--from check-targets --from-run <failed-run>` without re-running authoring. Verify the fresh run inherits vars correctly and that receipts stay bound to the frozen `itc-options.json` parentRunId. Decide explicitly which nodes are safe re-entry points — a wrong startable marker creates a skip-the-gates path (e.g. entering `fanout-send` directly would bypass `send-confirm` for live plans).

## Evidence

- Workflow: `plugins/kk/workflows/kk-itc.yaml` (no `startable:` anywhere)
- Manual tail sequence used in the dogfood: itc-check-targets, itc-send-targets, itc-send-targets --retry, itc-reconcile-receipts, itc-export-seo, itc-report-summary — all rc=0, receipts under `.works/kk-itc/spur-decision-brief/4-publish/receipts/`

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
