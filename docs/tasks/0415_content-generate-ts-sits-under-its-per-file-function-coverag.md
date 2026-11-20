---
schema_version: 1
name: content-generate.ts sits under its per-file function-coverage threshold
status: todo
template: issue
created_at: 2026-11-20T22:15:59.158Z
updated_at: "2026-11-20T22:15:59.385Z"
feature_id: G11

---

## 0415. content-generate.ts sits under its per-file function-coverage threshold

### Background

Captured from the creation title: "content-generate.ts sits under its per-file function-coverage threshold".

### Requirements

- [ ] R1. `apps/cli/src/commands/content-generate.ts` meets the per-file function threshold (>= 90%) so `bun run test` exits 0.
- [ ] R2. The uncovered paths are covered by behaviour tests against the seam that already exists (`setGenerateDeps` in `content-generate-inproc.test.ts`), not by exporting internals for their own sake.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. [ ] Covered so far: registration, itemCount, resolveNewsSettings, the pre-freeze bundle summary (commit f0…, this session).
2. [ ] Remaining uncovered functions: readJsonFile, readJsonValue, stampContentType, spawnStage, runRawCli, selectedCountOf, runGenerationReport, reportOptions, bundleSummary, runGenerateRow, buildContext, unfreezeRun.
3. [ ] Drive `news report` and `news generate` with the artifacts each row needs (a work dir carrying 4-publish/bundle.json, 5-report inputs, and a store route answering `{selected:N}`) so the row bodies execute in process.
4. [ ] `bun run test` exits 0; `spur rule run --preset recommended-post-check` reports no coverage-gate violation.

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
