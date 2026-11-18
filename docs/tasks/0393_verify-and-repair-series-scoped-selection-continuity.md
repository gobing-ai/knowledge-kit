---
schema_version: 1
name: Verify and repair series-scoped selection continuity
status: todo
template: feature-impl
created_at: 2026-11-18T04:42:14.702Z
updated_at: "2026-11-18T04:50:05.164Z"
feature_id: L3
priority: P1

estimate_hours: 8
---

## 0393. Verify and repair series-scoped selection continuity

### Background

Existing kk store extract excludes selected or published story IDs by topic (apps/cli/src/commands/store.ts:1257 and packages/kk-store/src/dao/items.ts:502). Prepare reserves candidates before final curation (apps/cli/src/commands/content-generate.ts:864). The three locally matching titles in the Huang incident have distinct story IDs and no joined selections. Local artifacts do not establish what aired.

### Requirements

- [ ] R1. Trace claimed repeats end-to-end and fix only demonstrated lifecycle or event-identity gaps. Preserve reuse by other series and replay semantics.

### Acceptance Criteria

- [ ] R15 — 每日节目按系列阻止重复使用已选新闻

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:05.163Z

**Ready decisions.** Own selection lifecycle and identity through the existing topic-specific ledger. Do not use the production db for fixture writes. Protect published items, release only unspent reservations and distinguish repeat stories from evidence-backed follow-up. Record evidence from the reproducer before changing event clustering. If actual incident evidence cannot be accessed, provide the trace and unresolved status alongside tested lifecycle behavior. Deliver stable final selected IDs and source proof to 0384.

**Source premise.** `packages/kk-store/src/dao/items.ts:502` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Replay two dated attempts and two topics, alternate titles/URLs, a materially updated event and a same-date retry. Check dropped, selected, published and missing-identity behavior against the DAO.

### Design

Use read-only report/bundle/ledger evidence from the actual producing host. Record episode dates, raw item IDs, URLs, story IDs, prior same-series status and actual final item IDs. Check same-day retries, dropped candidates and no-content releases, and parentRunId settlement. Preserve the existing topic/store ledger. If evidence demonstrates missed event identity, add deterministic canonical/reference matching plus bounded editorial duplicate review for ambiguous cross-source cases. Distinguish genuine event updates and corrections. Do not globally lower similarity or mutate production data.

### Plan

- [ ] Replay two episodes plus a second series with same original, syndication/paraphrase, material update and dropped versus published states. Retain a minimal reproduction for any bug. Verify retry, no-content and publish settlement against emitted content, and document the incident as unresolved if production evidence is unavailable.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
