---
schema_version: 1
name: "Dogfood the redesigned pipeline end-to-end"
status: todo
template: feature-impl
created_at: 2026-09-06T14:35:05.255Z
updated_at: "2026-09-06T18:04:32.913Z"
feature_id: L1
priority: P2
tags: ["dogfood", "feature-K"]
dependencies: ["0097"]
---

## 0098. Dogfood the redesigned pipeline end-to-end

### Background

Feature L1 R9 (edge): the redesign is proven only by replaying the dogfood scenario that motivated it — the 2026-09-06 corpus with archive pollution must still yield a clean 4-item episode, now through the new seams.

### Requirements

R1. Full pipeline run on fresh daily corpus with publish enabled.
R2. Assert: plan contains only fresh AI-news candidates; rejected.json audit exists; zh article + podcast episode publish; en/ja locales sync.
R3. Assert failure routes: fixture run with all-below-threshold corpus terminates done-no-content.
R4. Report appended to .spur/run/dogfood/ with wall-time comparison vs r6 (expect collect ≈ max(source times), not sum).

### Acceptance Criteria

- [ ] published episode contains only fresh AI news (no archives, no geopolitics)
- [ ] done-no-content fixture run clean
- [ ] dogfood report records pass/fail per assertion

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
WHAT: End-to-end dogfood of the redesigned kk-daily-ai-voice pipeline (post-0097). No production code — this is an operator-run verification task.

WHY: Feature L1 R9 — the redesign is only proven by replaying the scenario that motivated it (2026-09-06 pollution incident) through the new seams.

WHERE (frozen):
- Run dir: `.spur/run/daily-dogfood-<YYYYMMDD>/` (fresh date dir; do NOT reuse daily-dogfood-20260906 — its caches would mask regressions).
- Command: `spur workflow run plugins/kk/workflows/kk-daily-ai-voice.yaml --vars '{"work_dir":"…","skip_review":"true","transcode_mp3":"true","publish_enabled":"true","cover_enabled":"true","plan_translate_enabled":"true","agent":"auto"}' --run-id dogfood-<date>-r1 --json`
- Report: append to `.spur/run/dogfood/daily-ai-news-<date>.md` (same file family as daily-ai-news-20260905-r2.md).

Verification assertions (each with evidence):
1. collect state wall time ≈ max(source times), not sum (compare against r6's sequential timings: aihot ~2s, horizon ~20m).
2. quality-control-content emits candidates.json + candidates.rejected.json; rejected entries carry reasons.
3. Plan contains only fresh AI-news candidates (no aihot archives, no geopolitics).
4. show-notes.md produced by podcast-pub op (no inline bun -e); publish via new seams.
5. Empty-corpus fixture run (craft all-below-threshold input) terminates at done-no-content with zero 2-article/2-script/3-audio artifacts.
6. Publish: surfdash zh post live; podcast episode requires microfeed API up (note: D1 free-tier daily row-read quota was exhausted 2026-09-05 → if it recurs, record as external, not a pipeline failure).

Anti-patterns: no mocks for aihot/horizon/microfeed/surfdash (dogfood = real services); no cache reuse from prior run dirs; no skipping the empty-corpus leg.

Depends on: 0097 (the redesigned YAML must exist and validate).
### Plan

1. Run redesigned workflow with publish_enabled=true. 2. Verify artifacts + published surfaces. 3. Run empty-candidate fixture. 4. Append dogfood report.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
