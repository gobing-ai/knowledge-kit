---
schema_version: 1
name: Dogfood verify round of the enhanced AI-voice pipeline
status: todo
template: issue
created_at: 2026-09-11T23:55:04.611Z
updated_at: "2026-09-12T00:05:02.141Z"
feature_id: O
priority: P1
tags:
  - dogfood
  - verify

dependencies: ["0117", "0118", "0119"]
---

## 0120. Dogfood verify round of the enhanced AI-voice pipeline

### Background

Feature O / R5-R6. End-to-end confidence round: real surfdash publish + podcast episode carrying all landed enhancements, evidence recorded.

### Requirements

R5 (real transport verified live, fail-loud on missing SURFDASH_ROOT/POSTSURFING_BIN, published path exists on the site). R6 (dogfood run exercises report + timeline notes + URLs + tag; evidence recorded in wrap report).

### Acceptance Criteria

Dogfood run end to end: run report, timeline episode notes with timestamps and URLs, ai-news tag all verified against live state; evidence captured.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-12T00:05:02.141Z

- **Decision — real-cred end-to-end run (no dry-run substitute).** R5's deliverable is the live-wiring evidence; a `publish=none` or mocked run cannot produce it.
- **Deferred – None.** The dedicated news-article generator skill stays deferred (idea scope): daily-article-gen's revised output is the covered surface; revisit only if the dogfood round shows a coverage gap.

### Design

WHAT: one `/sp:dev-dogfood`-driven end-to-end run of `kk-daily-ai-voice` with publish enabled (real creds: `SURFDASH_ROOT`, `POSTSURFING_BIN`, `MICROFEED_*`). Assertions: R5 fail-loud contract on missing creds (no dummy success); accepted evidence = `run-report-<date>.md` exists with timing + scoring (0117), episode page shows timeline notes with timestamps and per-item URLs (0118), article frontmatter carries `ai-news` (0119). Evidence recorded in the wrap report; regressions become follow-up tasks.

FROZEN NAMES / WHERE: run workspace `<work_dir>` of the dogfood invocation; wrap report via `/sp:dev-wrap` on this task.

ANTI-PATTERNS: (a) no mocked/dry-run substitutions for this verify round — publish `none` does not satisfy R6; (b) no new transport code — if a wire gap appears, file it as follow-up work rather than patching inside the dogfood run.

HANDOFF: consumes deliverables of 0117, 0118, 0119 (dependencies recorded).

### Plan

Prepare real-cred env; RUN full pipeline with publish enabled; ASSERT run report present with the breakdown; ASSERT episode page shows timeline notes + timings + per-item URLs; ASSERT article frontmatter tags include ai-news; RECORD evidence in wrap report; file regressions as follow-up work.

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
