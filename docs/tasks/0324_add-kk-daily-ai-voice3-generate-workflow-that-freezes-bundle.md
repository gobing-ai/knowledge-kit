---
schema_version: 1
name: Add kk-daily-ai-voice3 generate workflow that freezes bundle.json
status: todo
template: feature-impl
created_at: 2026-10-22T18:41:32.327Z
updated_at: "2026-10-22T19:09:52.584Z"
feature_id: G15

dependencies: ["0323", "0327"]
priority: P2
estimate_hours: 6
---

## 0324. Add kk-daily-ai-voice3 generate workflow that freezes bundle.json

### Background

This is the generate half of the voice3 split (design §4). voice2 stays untouched. voice3 reuses voice2's stage commands and ends by freezing `bundle.json` (contract frozen in 0321 Design) for publish3 (0323).

**Refine corrections (2026-10-22)**

- Per-channel variants and `social-write` are produced by 0327. This task wires them into the graph and freezes them.
- The link placeholders are written by the 0327 builders, not by the bundle step.
- The `pool-count --min 1` guard appears 21 times in voice2 conditions. Its collapse relies on the engine rule already documented in voice2 (`run-report` description: all-deps-skipped skips a node; a done+skipped mix proceeds).
- The nested publish3 launch follows the voice2 nested-safety precedent (`kk-daily-ai-voice2.yaml:532`, `env -u SPUR_WORKFLOW_RUN_ACTIVE -u SPUR_EXPECTED_DEFINITION_DIGEST`).

### Requirements

- [ ] R1. `plugins/kk/workflows/kk-daily-ai-voice3.yaml` is a copy of the voice2 generate graph up to, but excluding, `publish-prep`:
  - topic → QC/translate → article/script/cover/cards/show-notes drafts → nested safety → review pause → audio (split → per-item TTS → assemble) ∥ images;
  - the voice2 per-channel enable vars (`xhs_enabled`, `wechat_enabled`, `*_live`, `publish_enabled`) are removed, because the preset owns channels;
  - `session-preflight` calls the 0325 preset probe.
- [ ] R2. Nodes `social-write` and `bundle-variants` (0327), then `bundle-freeze`: `kk stage run publish-matrix-bundle <workDir> --run-date <d> --run-id ${vars.__runId}`. It writes `bundle.json` (0321 `BundleSchema`: sha256 of every `30-variants/*` file plus `episode.title`) and fails if a variant required by an enabled preset row is missing.
- [ ] R3. One `pool-gate` node holds the `pool-count --min 1` condition. The nodes that previously repeated it depend on `pool-gate`, and no other node carries `pool-count`.
- [ ] R4. `auto_publish` var (default `false`). When true, the last node runs publish3 nested with `window=after-generate`, `work_dir`, `run_date`, `preset` and `dummy`, and its exit code is surfaced.
- [ ] R5. A DAG shape test plus an E2E with `dummy=true` and stubbed agent/TTS executors on a recorded fixture yields a valid `bundle.json`, and publish3 consumes it.
- Out of scope: retiring voice2; changing schedules for voice3 generation (operator swaps the 04:30 entry when ready).

### Acceptance Criteria

- [ ] AC1 — voice3 generate freezes a bundle publish3 can consume (req: R2, R4, R5)
- [ ] AC2 — Channel enablement no longer lives in the generate workflow (req: R1, R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T19:08:59.497Z

- **Q: Who owns the bundle writer?** Closed: the 0321 module (`publish-matrix-bundle`), so producer and consumer share one schema.
- **Q: Should voice3 auto-publish by default?** Closed: no (`auto_publish=false`), matching voice2's `publish_enabled=false` default. The operator flips it in the schedule.

### Design

- `publish-matrix-bundle` is the 0321 module's bundle writer and the only producer of `bundle.json`; it validates with `BundleSchema` before writing.
- The variant map is the `30-variants/` listing, so no hard-coded variant list lives in the workflow.
- Graph diff vs voice2:
  - drop: `publish-prep`, `publish-surfdash`, `show-notes` publish half, `publish-podcast`, `xhs-publish`, `wechat-publish`, `publish-classify`, `mark-published`, `run-report` publish half;
  - keep: generation nodes;
  - add: `pool-gate`, `social-write`, `bundle-variants`, `bundle-freeze`, `generation-report` (the existing `kk daily run-report` with publish fields absent), `publish`.
  - Note: `show-notes` authoring stays, because it is content.
- Anti-patterns:
  - no edits to `kk-daily-ai-voice2.yaml`;
  - no plugin names in voice3;
  - no publish side effects in voice3 except through the nested publish3.

### Plan

1. Failure list: a pool-empty run producing a bundle, a missing required variant passing freeze, voice2 drift, nested-run refusal (env vars), and a `pool-count` left in the YAML. (R1–R4)
2. Copy the voice2 generate nodes into voice3, remove the channel vars, and insert `pool-gate`. (R1, R3)
3. Add the `publish-matrix-bundle` stage (0321 module) and its test. (R2)
4. Add the `social-write`, `bundle-variants`, `bundle-freeze` and `publish` nodes. (R2, R4)
5. Add `apps/cli/tests/voice3-dag.test.ts`: the shape assertions (no `pool-count` outside `pool-gate`, no plugin names) and the fixture E2E through the bundle and nested dummy publish3. Keep the fixture work dir as the repeatable artifact. (R5)
6. Run `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice3.yaml`, `bun run gate`, and `git diff --stat plugins/kk/workflows/kk-daily-ai-voice2.yaml` is empty.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-22T18:59:28.584Z feature_id Q → G15 (system)
- 2026-10-22T19:09:52.584Z backlog → todo (system)

