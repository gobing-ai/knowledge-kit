---
schema_version: 1
name: Weibo article, X, Threads and LinkedIn publish rails still cannot confirm a daily post
status: todo
template: issue
created_at: 2026-11-19T22:00:52.977Z
updated_at: "2026-11-19T22:00:53.100Z"

---

## 0397. Weibo article, X, Threads and LinkedIn publish rails still cannot confirm a daily post

### Background

Captured from the creation title: "Weibo article, X, Threads and LinkedIn publish rails still cannot confirm a daily post".

### Requirements

Observed 2026-11-19 dogfood, after the identifiers and the episode bundle were unchanged from the previous runs:

- weibo-pub.article (cn-peak, live): first attempt "weibo article cover attachment: no outcome observed within 60000ms" (effect none, retry allowed); the retry then failed at "weibo article publish button:has-text(下一步): no outcome observed within 30000ms" (effect unknown). The 头条文章 editor has never been measured live; the account may also lack the entitlement.
- x-pub.post (overseas-rss): "x post submit never enabled — the editor did not accept the text in three attempts". Matches the 2026-11-16 recording: a [data-testid=mask] overlay intercepts the editor click and the card attach wedges Post.
- threads-pub.post: "threads post text was not retained: threads post readback: no outcome observed within 30000ms". Matches 2026-11-16: the inline composer never expands though a standalone probe typed into it.
- linkedin-pub.post: "linkedin Post button ... not attached within 30000ms" — the share trigger click does not reliably open the composer after the 2026-11-16 redesign.

Three of the four are effect:unknown, so the retry rules correctly refuse to resend them; nothing is duplicated. What is needed is one measured headed session per rail (kk bot record / the recorded-event harness used on 2026-11-16) so the selectors and the enablement conditions come from observation, not from the current guesses; then re-record the receipt baseline (newest /status/<id>, composer state) so a confirmation is provable.

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
