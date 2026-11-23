---
schema_version: 1
name: Centralize daily Xiaohongshu illustration direction
status: todo
template: feature-impl
created_at: 2026-11-23T01:20:51.116Z
updated_at: "2026-11-23T02:49:17.371Z"
feature_id: L4
priority: P2
tags:
  - daily-news
  - image-gen
estimate_hours: 4

dependencies: ["0424"]
---

## 0425. Centralize daily Xiaohongshu illustration direction

### Background

L4 R3 centralizes daily XHS art direction while keeping the deterministic card plan, compositor and attachment order.

**Refine corrections (2026-11-22)**
- `sourcePoint` and `itemId` are normalized daily-plan fields, not inputs supplied on `master.items[].card`. Author each master `subject` from its matching `Doc` and settled card copy. Read `sourcePoint` and optional `itemId` directly in legacy/manual plan mode.
- The scheduled cover and closing cards derive their subject from the existing cover/first-card fallback. Preserve that derivation rather than asking the writer for new episode-level fields.

Current-tree sources: plugins/kk/scripts/daily-stages.ts:5689, plugins/kk/scripts/daily-stages.ts:6543, apps/cli/tests/kk-workflow-stages.test.ts:2448, plugins/kk/workflows/kk-news-generate.yaml:420.

### Requirements

- [ ] R1. Install `kk:daily-news-illustrations` card mode and route current author, repair and legacy daily XHS visual directions through it.
- [ ] R2. Given a valid ordered plan with an existing composed card, render only the missing artwork through image-gen. Preserve the pinned format/style/provider/model, deterministic card copy, published manifest, fallback and optional episode-cover attachment.

### Acceptance Criteria

- [ ] AC1 — Daily cards share illustration direction and preserve their manifest

AC1 exercises R1 in the author/repair prompt fixture and R2 in the cached-card replay.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-23T01:21:30.188Z

**What stays in the card plan?** Keep copy, order, roles and source facts. Delegate the image scene to the daily illustration skill and use the existing card renderer and resume path.

#### Q&A entry — 2026-11-23T02:49:17.370Z

**How are card roles and story evidence handled?** Card art follows the corresponding selected item. The canonical master plan delegates only the subject. The daily renderer retains existing cover and closing scene fallbacks.

### Design

- Create `plugins/kk/skills/daily-news-illustrations/SKILL.md` with `card` mode. Use 0424's `visual_skill_root` and shared reference. The canonical writer skill stays responsible for `items[].card.copy`, `points`, story IDs and `cards.title/body`. Only delegate `items[].card.subject`; preserve repair scope. Source priority is matching approved Doc/lead and its retained fact, then choose a clear object or simple comparison without generated text.
- In the tracked legacy `xhs-write` prompts for voice and voice2, point to card mode and keep each plan's exact existing output, item scope and guards. For manual standalone work, emit the same `{title,body,cards}` plan and use `kk news generate-cards --work-dir` for a news run. Do not introduce a new agent hop, public verb, style preset, or renderer path.
- Preserve `dailyEditorialRender` cover/closing fallback and padding, and `dailyXhsRender` behavior including per-card retry, existing cached artifact checks, order, and episode cover last when the episode mode attaches it. Keep image-gen as the text-free artwork renderer and deterministic Chinese compositor. Leave the generic `kk:xhs-images` skill unchanged. Hand the card skill directory to 0426 for its inline mode.

### Plan

- [ ] Extend the editorial-render and cached-card scenarios in `apps/cli/tests/kk-workflow-stages.test.ts` with a sourced card scene and a pre-existing composed artifact.
- [ ] Add card mode and update only visual ownership and prompt pointers in `news-editorial` and the three daily workflows.
- [ ] Replay through the existing stage harness and assert one missing-card generation, original card ordering, deterministic text, preset/provider settings and the episode cover attachment.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
