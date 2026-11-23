---
schema_version: 1
name: Centralize daily news cover composition
status: todo
template: feature-impl
created_at: 2026-11-23T01:20:51.113Z
updated_at: "2026-11-23T02:50:01.024Z"
feature_id: L4
priority: P2
tags:
  - daily-news
  - image-gen
estimate_hours: 5

---

## 0424. Centralize daily news cover composition

### Background

L4 R1 and R2 centralize the scene authored for the existing text-free podcast cover and social crop. The cover plugin request is built by `dailyCover`, and `coverNormalizeBody` owns both outputs when there is a headline.

**Refine corrections (2026-11-22)**
- “Resolved plugin path” left legacy and custom writer behavior unspecified. The launcher already resolves an installed package root independently of the writer skill. Freeze one visual skill root for the canonical run and provide an explicit legacy override.
- The cover normalizer emits the OG image only when a headline exists. The positive replay uses a frozen Hook, and the legacy/missing-brief replay records the existing fallback without requiring a fabricated headline.

Current-tree sources: plugins/kk/skills/news-editorial/SKILL.md:92, plugins/kk/scripts/daily-stages.ts:942, plugins/kk/scripts/kk-workflow-stages.ts:1049, apps/cli/src/content-types.ts:153.

### Requirements

- [ ] R1. Ship `kk:daily-news-cover` and one shared, distribution-safe composition reference with original product-led, comparison, and metaphor examples. Examples name a sourced focal subject, spatial relationship and protected crop zone.
- [ ] R2. Scheduled master-plan write/repair and legacy daily cover prompts use that skill to author one text-free scene. Manual authoring emits the legacy-compatible subject brief and passes it to existing render entry points. Preserve existing headline, pins, path, cache and fallback behavior.

### Acceptance Criteria

- [ ] AC1 — Vendor composition patterns have daily news references
- [ ] AC2 — The selected lead drives the podcast and social cover

AC1 exercises R1 on the shipped references. AC2 exercises R2 on the current and legacy run paths.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-23T01:21:30.190Z

**Which cover text is authoritative?** Use the existing editorial Hook and frozen identity. The cover skill owns the scene and loads original composition examples from installed references.

#### Q&A entry — 2026-11-23T02:49:14.519Z

**Where does a scheduled agent resolve the visual skill?** Use the built-in package skill root supplied by the launch. Direct workflow callers can pass the same root, with a checkout-relative default. The news writer's path remains independent.

### Design

- Create `plugins/kk/skills/daily-news-cover/SKILL.md` and shared `plugins/kk/skills/news-editorial/references/daily-visual-composition.md`. Choose product-led when a sourced product form is recognizable, comparison only for a sourced A/B fact, otherwise a concrete object metaphor. Protect the center crop and headline/logo zones already owned by `cover-compositor.ts`. Keep scene English and ≤240 characters, with no generated lettering, logos or identifiable people. Use separately supplied reference assets only if the existing render entry takes them.
- In `apps/cli/src/commands/content-launch.ts`, initialize news-only `visual_skill_root` from `resolvePackageRoot(fs)/plugins/kk/skills`. Declare it in `kk-news-generate.yaml` with a checkout-relative default `plugins/kk/skills` for direct workflow calls. Pass the resolved cover SKILL.md path as a brief pointer in `script-write` and `script-fix`. The built-in `news-editorial` prompts keep ownership of `cover.headline`, `sourceIds`, validator repair scope and old string input. Custom writer lookup stays independent. Add the same default/override to tracked voice and voice2 workflows for their legacy cover prompts, keeping each workflow's existing JSON path and guard.
- Keep `{subject}` as the manual/legacy brief shape, with `headline` supplied only by settled editorial input when available. Reuse the existing mock runner for standalone verification. Preserve the legacy workflows’ existing final-cover file guards. The canonical generate-render stage only gates on cover_enabled and this task adds no cache there. Keep the `daily-news-podcast-cover` × `quasi-news-podcast` input envelope, MiniMax/image-01 as today’s default, configured overrides and existing 1344×576 PNG / 1200×630 JPG paths. Generic image authoring and renderer changes are outside this task. Deliver `visual_skill_root` and the shared composition reference to 0425 and 0426.

### Plan

- [ ] Extend the packaged-path assertions in `apps/cli/tests/content-launch.e2e.test.ts` and use the mock cover/normalize tests in `plugins/kk/tests/daily-cover-{mock,normalize}.test.ts` for the scene, headline and dimensions replay.
- [ ] Add the skill and examples, wire the canonical/legacy prompt pointers, and retain all existing input/output keys.
- [ ] Replay valid and absent/legacy briefs against fake image-gen inputs, assert pinned envelope and frozen headline, then inspect both output dimensions in the existing macOS compositor fixture. Update `docs/04_DESIGN.md` for the workflow surface.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
