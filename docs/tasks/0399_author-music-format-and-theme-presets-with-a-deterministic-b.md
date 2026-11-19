---
schema_version: 1
name: Author music format and theme presets with a deterministic brief renderer
status: backlog
template: feature-impl
created_at: 2026-11-18T22:16:14.918Z
updated_at: "2026-11-19T03:55:02.671Z"
feature_id: D8

ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 8
dependencies: ["0398"]
---

## 0399. Author music format and theme presets with a deterministic brief renderer

### Background

Implements: R1 — format presets; R2 — theme presets; R3 — resolution reuses 0397 R4; R4 — evidence discipline; R5 — preset index doc.

`image-gen` established the platform pattern for creative presets: a format (canvas/template/job) composes with a style (visual modifiers), resolution is a pure function, presets are data files with an index README, and imported candidates stay "generation-pending" until a real generation review promotes them (feature K3, `plugins/generations/image-gen/src/presets.ts`). Music needs the same shape — but its axes are different: a **format** fixes the job's intent and structural skeleton (song vs 30-second clip vs jingle), while a **theme** supplies the technical direction prose the model actually reads (genre, BPM range, key, instrumentation, vocal character, production, avoid list).

Nothing here may name a provider, a base URL, or an API model id: the instance maps `pro|clip` to `lyria-3-pro-preview`/`lyria-3-clip-preview`, and presets must survive a future provider swap unchanged (feature R2).

### Requirements

- [ ] R1. Ship format presets as data: `song` (pro, 2:30 default target, full section skeleton), `clip` (clip model, no duration target, ~0:30 by model), `jingle` (pro, 0:20 target), `loop` (clip, no vocal), `underscore` (pro, instrumental bed, no hook requirement). Each declares model, default duration target (pro only), structure skeleton with timestamps, and lyrics policy (allowed/forbidden). No price field: prices are provider-specific and live in user config (0400).
- [ ] R2. Ship theme presets as data with the technical-direction segment, default `avoid[]`, vocal-character guidance, and an instrumentation palette. The first set is bounded to `cinematic`, `lofi`, `synthwave` and `ambient-tech`. `corporate-tech` and `xhs-pop` are reserved for a later evidence round and are not shipped. No theme may claim a quality result it has not produced.
- [ ] R3. Implement resolution as the pure function frozen in 0397 R4 (brief → workflow preset → theme → format → built-in). An unknown name fails with a non-zero exit and no silent fallback, and a printed explanation lists every source that contributed.
- [ ] R4. Enforce evidence discipline on preset files: a provenance block (authoring source, date, status `authored | evidence-pending | verified`), no provider/model/price keys, and a schema check that rejects them. The loader test matrix includes one deliberately invalid file per rule.
- [ ] R5. Render the preset index: `plugins/generations/music-gen/README.md` lists every format and theme with its intended use and status. A script generates it, so the index cannot drift from the data files.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Format presets fix structure without pinning the provider (req: R1, R4)
  Given the five shipped format presets
  When each is loaded
  Then each declares model, structure skeleton and lyrics policy, and every pro format declares a duration target
  And no file contains a provider, base URL, API model id or price
  And the clip and loop formats resolve to a request with no durationTarget

Scenario: AC2 — Themes carry the technical direction the model reads (req: R2)
  Given a theme preset
  When it is rendered into a brief
  Then its prose covers genre, tempo, key, instrumentation, vocal character and production
  And its default avoid-list is rendered as one `Avoid: …` segment
  And its status is one of authored / evidence-pending / verified

Scenario: AC3 — Precedence is deterministic and explained (req: R3)
  Given a brief, a workflow preset, a theme and a format that each set duration and lyrics policy
  When the job is resolved
  Then the 0397 precedence decides each field and the CLI prints which source won
  And an unknown format or theme name exits non-zero listing the valid names

Scenario: AC4 — Invalid preset files are rejected with a reason (req: R4)
  Given preset files that declare provider, model id, price, unknown status, or a missing provenance block
  When the loader runs
  Then each is rejected with a field-specific error naming the file
  And no partially loaded preset reaches the renderer

Scenario: AC5 — The index matches the data (req: R5)
  Given the shipped presets
  When the index generator runs in check mode
  Then the README table equals the preset inventory and the check fails on drift
  And each row shows use case, status and default duration
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **Bound the first set.** 5 formats × 4 themes = 20 combinations, but only the pairs a workflow actually uses need a real generated sample. The rest ship as `authored`. K3's lesson: bulk import without generation review produces presets nobody can trust.
- **Structure skeletons belong to formats, not themes.** A theme that dictated arrangement would fork into one theme per genre. The format owns the arc and the theme owns the sound.
- **`avoid[]` is prompt text.** Lyria 3 has no `negative_prompt` parameter, so the renderer emits a single `Avoid: a, b, c` segment. Themes supply defaults, briefs override, and the segment is dropped when the merged list is empty.
- **Clip formats skip structure timestamps past 0:30.** Clip is fixed at about 30 s, so a `clip`/`loop` skeleton longer than that is rejected by the loader instead of being sent as text the model cannot honour.
- **Index generator, not a hand-maintained table.** `image-gen/scripts/gen-samples.ts` showed that hand-maintained preset docs drift. Check mode makes drift a test failure.
- **Prices removed from presets (closed 2026-11-18).** A price is a fact about the provider path (Gemini vs OpenRouter), not about the musical format. Keeping it here would break the "presets survive a provider swap unchanged" rule. Prices live in 0400's config block.
- **Dependency.** Blocked by 0398. Does not block 0400.
- **Estimate.** 8h: 5 formats + 4 themes + resolver + loader validation + index generator + tests.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-19T00:14:06.546Z feature_id Q → D8 (system)

