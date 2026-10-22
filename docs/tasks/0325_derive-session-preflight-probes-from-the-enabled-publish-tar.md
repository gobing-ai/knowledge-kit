---
schema_version: 1
name: Derive session-preflight probes from the enabled publish targets
status: todo
template: feature-impl
created_at: 2026-10-22T18:41:32.723Z
updated_at: "2026-10-22T19:09:50.452Z"
feature_id: G15

dependencies: ["0321"]
priority: P2
estimate_hours: 2
---

## 0325. Derive session-preflight probes from the enabled publish targets

### Background

voice2 `session-preflight` (`plugins/kk/workflows/kk-daily-ai-voice2.yaml:178`) hard-codes `kk plugin check wechatmp-pub xhs-pub`, so enabling a channel requires a workflow edit (boundary violation, design §6).

**Refine corrections (2026-10-22)**

- The probe derivation itself is implemented by 0321 R3 (`publish-matrix-check`). This task is the voice3/publish3 adoption plus the generate-side preflight: voice3 must warm the same sessions before the long generation, not discover an expired login at publish time.
- voice2 is not edited (operator constraint); its hard-coded list stays.

### Requirements

- [ ] R1. The probe set is the distinct plugins of `mode ∈ {draft, live}` rows across every window the preset enables. It is computed from the preset, because at generate time no plan exists yet. An empty set means the node passes and prints `no probes`.
- [ ] R2. Add `kk stage run publish-matrix-check <workDir> --preset <slug> --all-windows`, a preset-only mode of the 0321 check that needs no plan file. voice3's `session-preflight` node calls it warn-only. publish3's `check` node calls the plan form.
- [ ] R3. Reuse ADR-032 `kk plugin check` (`apps/cli/src/commands/plugin.ts:195`, 60s probe budget); no new probe mechanism.
- Out of scope: editing voice2; auto-login (stays `kk bot login`, operator action).

### Acceptance Criteria

- [ ] AC1 — The channel matrix comes from a config-selected publish preset (req: R1, R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T19:09:01.079Z

- **Q: Probe from the plan or the preset at generate time?** Closed: the preset, because the plan needs the bundle, which does not exist before generation.

### Design

- One extra input mode on `checkPublishMatrix` (0321): `{ preset, allWindows: true }` → rows = resolved preset targets (no bundle) filtered `mode !== 'off' && mode !== 'dummy'`, keyed distinct by plugin.
- The output path is `4-publish/check.preflight.json`; the node is non-blocking (`onError: continue`), matching voice2 session-preflight semantics.
- Anti-patterns: no plugin names in workflow YAML; no second probe runner.
- Handoff: 0324 places the node; 0323 uses the plan form.

### Plan

1. Failure list: an empty preset, all-dummy (zero probes), a probe timeout (warn, not fail), and an unknown plugin in the preset (fail: preset invalid).
2. Add the `--all-windows` preset mode to `checkPublishMatrix` with an injectable probe runner. (R1, R2)
3. Test in `publish-matrix.test.ts`: the daily-ai-voice preset with two `draft` browser rows yields exactly those two probes, and all-dummy yields none. (R1)
4. Run `bun run lint && bun run test`.

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
- 2026-10-22T19:09:50.452Z backlog → todo (system)

