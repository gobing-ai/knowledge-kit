---
schema_version: 1
name: "Surf of the digest headline contract: kk demands two title headlines while the site's aligned plan can collapse to one"
status: todo
template: issue
created_at: 2026-11-19T22:00:27.891Z
updated_at: "2026-11-19T22:00:28.092Z"

---

## 0395. Surf of the digest headline contract: kk demands two title headlines while the site's aligned plan can collapse to one

### Background

Captured from the creation title: "Surf of the digest headline contract: kk demands two title headlines while the site's aligned plan can collapse to one".

### Requirements

Observed 2026-11-19 (dogfood of the scheduled daily run after the variants safety gate admitted the bundle).

kk side: plugins/kk/scripts (topic-claims gate, used by surfdash-pub and by the plugin digest check) requires a daily title with exactly two non-empty headlines joined by the locale separator. Measured failure: "zh: digest frontmatter check failed: title: expected exactly two non-empty headlines joined 、, got Will Wright".

Site side: surfdash scripts/commands/seo/retitle.ts derives title/key points from an aligned cross-locale plan (alignedKeyPointPlan). After the en/ja locale files were authored by hand (kk has no translate step), the plan yielded ONE headline slot, so "bun scripts/surfdash.ts seo retitle --write" rewrote all three titles to a single headline, and its own validator then accepted them (title has only 1 headline is a failure only when twoHeadlinesThatFit says two fit).

Consequence: surfdash-pub.post can never reach a confirmed receipt for such a day. The 2026-11-19 post IS live (https://surfing.salty.vip/{zh,ja,}/posts/20261119-ai-2026-11-19 all 200) because the site orchestrator was run directly with the plugin env, but the kk receipt stayed uncertain/unknown and the window classified partial.

What is needed: decide the contract owner. Either (a) kk gains a translate step that keeps en/ja sentence-aligned with zh so the site plan always yields two slots, or (b) the kk digest gate accepts one headline when the site plan collapses, mirroring the site rule. Evidence and the three locale bodies are in .works/kk-news-generate/20261119 and /Users/robin/xprojects/surfdash (uncommitted).

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
