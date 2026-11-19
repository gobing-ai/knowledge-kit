---
schema_version: 1
name: Dogfood one music track end to end and sync the owning docs
status: backlog
template: feature-impl
created_at: 2026-11-18T22:16:17.582Z
updated_at: "2026-11-19T00:14:21.344Z"
feature_id: D8

ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 5
---

## 0391. Dogfood one music track end to end and sync the owning docs

### Background

Implements: R1 — one real end-to-end track; R2 — evidence and spend record; R3 — docs sync; R4 — streaming-only delivery, channel profiles deferred; R5 — residuals filed; R6 — CI-safe acceptance artifact.

Features in this repo close on evidence, not on claims: K3's promotion gate, the daily pipelines' run reports, and the `docs/tasks/evidence/<feature>/<wbs>/` convention. A music capability that has never produced a mastered file from an idea is unproven regardless of green unit tests — and the reverse is also true, so the acceptance run must show both a free dry-run and one paid take with its measured numbers.

Docs ownership: `docs/04_DESIGN.md` indexes the design satellite (0384), `docs/05_FEATURES.md` points at the generated feature index, and the plugin README is the preset index (0386). This task closes that loop.

### Requirements

- [ ] R1. Run the pipeline end to end on a real idea using the live instance: a song-format run with `directions: 2` (two Pro takes), operator selection, analyze, check, judge and master to the `streaming` profile, with no manual step outside the workflow's own gates.
- [ ] R2. Preserve reproducible evidence under `docs/tasks/evidence/D8/0391/`: briefs, kk prompt text, instance ids, `checks.json`, verdict JSON, measured duration/LUFS/true peak before and after normalization, and the spend summed from take sidecars.
- [ ] R3. Sync the owning docs: the `docs/04_DESIGN.md` link to the new satellite, `docs/05_FEATURES.md`/feature index for D8, the plugin README preset index with real statuses (which pairs were actually generated), and the workflow list wherever `kk` enumerates workflows.
- [ ] R4. Ship only the built-in `streaming` delivery profile. Channel loudness profiles (小红书 / B站 / 视频号 or others) are deferred until a publish platform for music is chosen; record that deferral in the feature Notes, and add no channel profile, to shipped defaults or to evidence, in this feature.
- [ ] R5. File residuals as new tasks rather than widening this one, and record accepted limitations (single-turn iteration cost, analysis latency, preset coverage, the Clip-explore decision) in the feature Notes.
- [ ] R6. Leave a CI-safe acceptance artifact: a dry-run transcript plus the evidence paths, so a later regression can compare without spending money.

### Acceptance Criteria

```gherkin
Scenario: AC1 — One complete run produces a delivery-ready file (req: R1)
  Given a real idea, a configured instance and a confirmed selection
  When the workflow runs to completion
  Then a normalized audio file exists whose measured loudness and true peak meet the selected delivery profile
  And the original provider take is preserved byte-for-byte
  And every state produced its artifact without a manual shell step

Scenario: AC2 — Evidence is reproducible and complete (req: R2)
  Given the acceptance run
  When the evidence directory is read
  Then it contains briefs, kk prompt text, instance ids, checks.json, verdict JSON, before/after measurements and the summed spend
  And every claimed number is traceable to the tool that produced it

Scenario: AC3 — Docs match the shipped reality (req: R3)
  Given the merged feature
  When the doc set and plugin README are checked
  Then 04 links the satellite, the feature index lists D8 under D with its tasks, and the preset index marks only the pairs that were actually generated as generated
  And no doc claims a capability or a provider that was not exercised

Scenario: AC4 — Channel loudness stays deferred (req: R4)
  Given the merged feature
  When the delivery profiles and feature Notes are inspected
  Then streaming is the only built-in profile
  And no channel-specific profile is shipped
  And the feature Notes record channel profiles as deferred to the publish-platform decision

Scenario: AC5 — Open work is filed, not swallowed (req: R5)
  Given limitations and defects found during the run
  When the feature closes
  Then each has either a filed task with evidence or an accepted-limitation note in the feature Notes
  And this task's Requirements are all checked or explicitly deferred with a reason

Scenario: AC6 — A free regression path exists (req: R6)
  Given the dry-run transcript in the evidence directory
  When a later change re-runs the dry-run
  Then the same artifacts are produced offline for comparison
  And the comparison needs no paid call
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **Do the cheap loop first.** Start with a `KK_MUSIC_DRY_RUN=1` run to prove the plumbing, then spend exactly one explore round. The acceptance spend is two Pro takes ($0.16) plus one analysis (unpriced, small), recorded from sidecars.
- **Measure, do not listen.** "It sounded fine" is not evidence. The report quotes duration vs target, LUFS and true peak before and after normalization, and the analysis BPM/key against the brief.
- **Keep the original.** Normalization writes a new file and the provider take stays untouched, so a later re-normalization to another profile or a re-judge is possible without re-paying.
- **Channel targets are deferred, not guessed.** Which platform publishes music is undecided, and no published loudness spec for 小红书, B站 or 视频号 was verified. The publish feature that picks the platform measures one real re-served upload and adds that profile through 0394's config mechanism, with no code change here. If the track ends up as background under a voice-over, the video mix sets final loudness anyway.
- **Docs last, with real statuses.** Only pairs generated during this run get `generated` in the preset index. Everything else stays `authored`/`evidence-pending`, matching K3's discipline.
- **Dependency.** Blocked by 0389, 0390 and 0394.
- **Estimate.** 5h: run + evidence + doc sync + residuals.

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

