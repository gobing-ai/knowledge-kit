---
schema_version: 1
name: Flatten single-file step outputs across itc, solo-podcast, and daily-ai-voice workflows
status: todo
template: feature-impl
created_at: 2026-09-14T17:55:18.374Z
updated_at: "2026-09-14T17:59:45.462Z"
feature_id: F8
priority: P2
tags:
  - kk
  - workflows
  - layout

---

## 0128. Flatten single-file step outputs across itc, solo-podcast, and daily-ai-voice workflows

### Background

Feature F8 extension. The accepted convention: a workflow step that emits exactly one file writes `<work_dir>/<step>-<name>` at the work_dir root with no single-file stage directory; steps emitting multiple files keep their stage directory. kk-storm-research is already flat (no change). This makes per-run output trees shallow and predictable.

Covers feature F8 scenarios: R5 (Single-file steps are flattened to <step>-<name> at the work_dir root), R6 (Existing .works contents are never migrated).

### Requirements

- [ ] R1. In `plugins/kk/workflows/kk-itc.yaml`, `3-draft/draft-article.md` moves to `<work_dir>/3-draft-draft-article.md`; the `3-draft` mkdir segment and every reference (expectFile line 128, draft/review/revision prompts, judge prompt, §6 report line) follow. `2-outline/` (outline-option-a/b/c + outline-approved.md) keeps its stage dir; `brief.md` and `.itc-verdict.json` stay at the root.
- [ ] R2. In `plugins/kk/workflows/kk-solo-podcast.yaml`, `1-briefing/briefing.md` moves to `<work_dir>/1-briefing-briefing.md` and `3-script/voicescript.yaml` moves to `<work_dir>/3-script-voicescript.yaml` — both are verified single-file stages under the locked convention (prompts, expectFile lines 81/159, validate/wrap invocations, mkdir segments follow). `2-outline/` (options + approved) and `4-audio/` (docs.json + content.json + content.wav) keep their stage dirs.
- [ ] R3. In `plugins/kk/workflows/kk-daily-ai-voice.yaml`, enumerate all eight stage dirs (1-ingest, 2-facts, 2-plan, 2-article, 2-cover, 2-script, 3-audio, 3-publish) with file counts from the YAML and record the enumeration; flatten exactly the single-file ones to `<step>-<name>`. On the current YAML every stage emits ≥2 files (1-ingest ≥3 config/blended outputs; 2-facts, 2-article, 2-script 2 each; 2-plan ≥4; 2-cover ≥2 incl. normalized artifact; 3-audio ≥2), so the expected diff is no path changes — the enumeration must be recorded, not assumed, and any stage found to emit exactly one file is flattened. All cache guards (collect/facts/plan/article) keep hitting on re-run.
- [ ] R4. The §6 Report lines in `plugins/kk/commands/workflow-run.md` print the new flattened paths (itc: `3-draft-draft-article.md`; solo-podcast: `1-briefing-briefing.md`, `3-script-voicescript.yaml`, `4-audio/*`).
- [ ] R5. `apps/cli/tests/kk-solo-podcast-workflow.test.ts` plus the other YAML-referencing tests (`kk-itc-workflow.test.ts` asserts the `3-draft/draft-article.md` expectFile; `kk-daily-ai-voice-workflow.test.ts` asserts stage paths) assert the new paths.
- [ ] R6. No existing `.works` content is migrated or renamed; root dotfiles (`.revise-count`, `.duration-ok`, `.itc-verdict.json`, `step-timing.json`) are untouched.

### Acceptance Criteria

```gherkin
Scenario: Single-file steps are flattened to <step>-<name> at the work_dir root
  Given kk-itc runs to completion
  Then <work_dir>/3-draft-draft-article.md exists and no 3-draft/ directory is created
  Given kk-solo-podcast runs to completion
  Then 3-script-voicescript.yaml is at the work_dir root
  And 4-audio/ still holds content.json and content.wav
  Given kk-daily-ai-voice runs to completion
  Then exactly the single-file stages are flattened and every cache guard still hits on re-run

Scenario: Existing .works contents are never migrated
  Given leftover directories from earlier layouts under works_dir
  When any run completes
  Then those directories are left byte-identical
```

Task-local checks: every expectFile / prompt / gate / cache-guard reference in the three YAMLs matches the new paths; workflow-run.md summary lines print the flattened paths; `apps/cli/tests/kk-solo-podcast-workflow.test.ts` asserts the new layout.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: path rewrites inside three workflow YAMLs plus the command's §6 summary text. WHY `<step>-<name>` (not bare `<name>`): deterministic, collision-safe when two steps would emit same-named files, and greppable by step — convention locked at idea-eval. Per-file enumeration is done from the YAML itself before editing (inventories verified and recorded in R1–R3); a stage is flattened only when exactly one output file is written there. Coordination: this task owns workflow-run.md §6; the workspace task owns §1/§3/§4 — land this second. Invariants: multi-file stages and root files unchanged; no mkdir for flattened stages; every expectFile/prompt/gate/cache-guard reference updated in the same edit. Skipped: touching kk-storm-research.yaml (verified already flat); renaming root dotfiles (not stage outputs).

### Plan

1. Re-enumerate stage dirs and file counts in kk-itc.yaml, kk-solo-podcast.yaml, kk-daily-ai-voice.yaml; record in Solution.
2. Rewrite single-file stage paths to `<work_dir>/<step>-<name>`; drop their mkdir segments (itc `3-draft`; solo `1-briefing`, `3-script`).
3. Update every expectFile / prompt / gate / validate / wrap / cache-guard reference in the three YAMLs.
4. Update workflow-run.md §6 report lines.
5. Update kk-solo-podcast-workflow.test.ts, kk-itc-workflow.test.ts, kk-daily-ai-voice-workflow.test.ts; `bun run lint` + targeted `bun test` on the three files.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
