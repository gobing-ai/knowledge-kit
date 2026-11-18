---
schema_version: 1
name: Calibrate daily topic filters and report candidate losses
status: todo
template: feature-impl
created_at: 2026-11-18T04:42:14.699Z
updated_at: "2026-11-18T04:50:04.954Z"
feature_id: L3
priority: P1

estimate_hours: 7
---

## 0392. Calibrate daily topic filters and report candidate losses

### Background

Code floor is leadership/date only (plugins/kk/scripts/topic-boundary.json:1), but the Agent still excludes entire public-affairs classes (plugins/kk/skills/news-editorial/SKILL.md:46). Existing QC writes exclusion evidence only on hits. The normal report is behind the pool gate (apps/cli/src/commands/content-generate.ts:418).

### Requirements

- [ ] R1. Inventory every selection filter and platform gate, including adult content, gambling, drugs, domestic politics and leadership. Reproduce overly broad matches using historical and contrast fixtures, including an AI-relevant public-policy story. Keep actual platform restrictions enforced.

### Acceptance Criteria

- [ ] R14 — 过滤规则按内容风险校准并在最终报告留证

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:04.953Z

**Ready decisions.** Own QC/curation rule calibration and the final report projection. Keep verified platform admission gates in place. Correct wide editorial category exclusions with tagged historical and counterexample samples. Keep one versioned per-attempt counts artifact and consume it on ordinary and no-content report paths. Document whether each counter is unique IDs or rule hits; leave missing stage evidence unknown. Hand the revised editorial policy to 0385.

**Source premise.** `plugins/kk/skills/news-editorial/SKILL.md:46` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Assert counts reconcile after retries, zero kept, multiple hits and skipped stages. Pair a relevant industry/public-policy item with a hard-rule hit.

### Design

Code owns versioned rule checks and deterministic counts. Agent owns context and attribution. Keep current confirmed hard constraints pending an explicit policy decision, and keep publication admission per channel. Reuse the QC artifact and news-report-gen. Record reconciled stage counts, unique exclusions, per-rule hits and decisions plus no-content diagnostics. Capture raw pre-filter counts before mutation. Bind evidence to attempt and fingerprints so retries do not erase results or inherit stale reasons.

### Plan

- [ ] Build replay fixtures for policy and editorial overlap, clear versus incidental matches, multiple hits, and zero survivors. Audit the shipped skill and legacy report cases against current invocations. Calibrate on labeled examples before changing narrow rules. Run generation and report for passing and empty cases, including cached reruns, and leave inspectable Markdown plus JSON evidence.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
