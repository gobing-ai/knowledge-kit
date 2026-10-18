---
schema_version: 1
name: "horizon-ingest strips outbound links: summary-class story twins can never URL-cluster"
status: todo
template: issue
created_at: 2026-10-18T23:55:39.437Z
updated_at: "2026-10-18T23:56:08.637Z"

---

## 0317. horizon-ingest strips outbound links: summary-class story twins can never URL-cluster

### Background

Found during 0316's deferred live repair (2026-10-18): the URL-identity story clustering
(`storyIdForUrls`, shipped in 465d6cf9) cannot merge the motivating twin pair in the live store
because horizon-ingest renders bodies as `### [title](own-url) ⭐️` + summary prose — the original
outbound links are stripped, and `metadata.references` is empty. The simonwillison link post
(`3bc592cc5b…`) references the claude.dev primary source only as prose, never a hyperlink, so
neither body's URL set intersects the other's `canonical_url`. Consequence: any twin pair whose
bodies come from summary-rendered ingest can never URL-cluster; the 24h extract window hides it,
a widened window (`--window 48h`) re-admits a published story's twin. Live evidence:
`sqlite3 .works/kk.db` — both items' bodies contain exactly one URL (their own); backfill-facts
reports `{updated: 0}` with the pair still split.

### Requirements

- [ ] R1. Decide where outbound links are preserved: horizon-ingest keeps the original item's outbound http(s) links in the rendered body or in `metadata.references`, OR clustering reads a new link source — picked so summary-rendered twins become URL-clusterable.
- [ ] R2. After R1, the live motivating pair (`6d6f8ad075…` claude.dev / `3bc592cc5b…` simonwillison, first_seen 1792192521382) merges under one `story_id` via `kk store backfill-facts` (or a documented one-time repair), proven by the 0316 Evidence SQL returning a single group.
- [ ] R3. No re-clustering regression: existing story roots stay stable for pairs that share no URL (negative case from packages/kk-store/tests/dao/items-v2.test.ts:283 stays green).

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
