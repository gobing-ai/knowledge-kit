---
schema_version: 1
name: "End-to-end verification run of refined solo-podcast workflow"
status: todo
template: feature-impl
created_at: 2026-08-23T23:37:50.939Z
updated_at: "2026-08-24T00:19:03.683Z"
feature_id: F7
dependencies: ["0078"]
---

## 0079. End-to-end verification run of refined solo-podcast workflow

### Background

<!-- Why this task exists: the problem, motivation, and context. Self-contained — readable without the parent. -->

### Requirements
- [ ] R1. Install the rewritten workflow via the kk-solo-podcast profile of `plugins/kk/commands/workflow-run.md` (two-root copy: YAML + `validate-voicescript.ts` + `wrap-voicescript-doc.ts` into `$KK_WORKFLOWS_DIR` / `$HOME/.config/kk/workflows`).
- [ ] R2. Execute an end-to-end run on the CI/dry-run path: `spur workflow run` with vars `topic` (a short sample topic), `work_dir` (scratch dir), `voice_profile`, `outline: "a"`, `script_approved: "true"`, `force: "true"`, `target_duration_min: "1"` — no HITL pauses; walk prepare → understand → outline-write → outline-commit → script-write → script-validate → wrap-docs → generate → duration-check → done.
- [ ] R3. Evidence per claim: the transcript shows each `agent.run` node invoking `kk:audio-authoring` with the right operation; `1-briefing/briefing.md`, `2-outline/outline-approved.md`, `3-script/voicescript.yaml` exist; `validate-voicescript.ts` exits 0 on the script; `4-audio/docs.json` is produced by the helper.
- [ ] R4. Duration check exercised: generated `content.json` duration within band → done; if TTS is unavailable in the environment, the missing-content.json dry-run pass path is the accepted evidence and is stated as such.
- [ ] R5. Exercise the revise path once with a bounded check: reject at script-review is simulated by unit-level guard evaluation (not a full re-run) — confirm the `.revise-count` increments under `work_dir` and the `duration-check → script-write` edge exists per 0078 (static assertion is sufficient; full HITL loop is manual-only).
- [ ] R6. Record all evidence in ## Testing; `bun run lint` + `bun run test` green at the end.

**Non-goals:** real multi-minute TTS generation as a blocking requirement; publishing audio; running the interactive HITL path (operator-driven, not this ticket).
### Acceptance Criteria
```gherkin
Feature: Solo-podcast refined workflow end-to-end

  Scenario: Dry-path run completes
    Given the installed rewritten workflow with both sidecars
    When a CI-mode run executes with outline=a and script_approved=true
    Then the run reaches done without HITL pauses
    And briefing, approved outline, voicescript.yaml, and docs.json exist under work_dir
    And the transcript shows kk:audio-authoring invoked at each authoring node

  Scenario: Duration and revise mechanics hold
    When duration and revision guards are exercised
    Then .duration-ok gates the done transition
    And the revise counter increments under work_dir only
```
### Q&A
- **TTS availability:** real audio generation is best-effort; the missing-content.json dry-run pass is accepted evidence (stated explicitly per R4).
- **Agent backend:** if `agent.run` cannot execute in this environment, record PARTIAL evidence with the exact halt point — no silent green (see ## Design known constraint).
- **Open:** none blocking.

References: map `docs/features/F7_audio-authoring-skill-extraction-wayfinder-map.md`; `plugins/kk/commands/workflow-run.md`; `docs/design/kk-solo-podcast.md`; deps 0077/0078.
### Design
**WHAT:** One end-to-end verification run of the rewritten `kk-solo-podcast` workflow (post-0078) on its dry-run/CI path, with per-claim evidence recorded.

**WHY:** F7 is a shipped refactor — the map closes only when the refined pipeline demonstrably runs. This ticket is the Shippable evidence for the whole map.

**WHERE (frozen names):**
- Runs against `$KK_WORKFLOWS_DIR/kk-solo-podcast.yaml` (or `$HOME/.config/kk/workflows/`), NOT the design-time copy — install via the `workflow-run` profile first (R1).
- Scratch work_dir: `$WORKS_DIR/solo-podcast-verify-<date>` (or `mktemp -d`); never inside the repo.
- Evidence lands in this task's ## Testing (transcript excerpts + file existence checks + exit codes).

**Execution shape:** single `spur workflow run "$dest" --vars '{"topic":"…","work_dir":"…","voice_profile":"…","outline":"a","script_approved":"true","force":"true","target_duration_min":"1"}'`. The 1-minute target keeps the LLM authoring cheap. `vars.agent` unset → engine default.

**Known constraint (pre-verified):** `agent.run` nodes need a working agent backend; if the environment lacks one, the run halts at `understand` — that is an environment limitation, recorded as PARTIAL evidence with the exact failure, not silently skipped. The fallback accepted evidence set is then: install correctness (R1), static contract checks (0078's tests), and guard-level simulation (R5).

**Anti-patterns:** do not hand-edit the installed YAML to force a pass; do not mark done on a partial run without stating exactly which R-items carry dry-run/static evidence; do not run inside the repo tree (the `.revise-count` and stage dirs must not pollute the checkout).

**Assumes from deps (0078):** the rewritten workflow + helper + workflow-run sidecar copy are merged. **Leaves for dependents:** none — terminal ticket of the map.
### Plan
1. Install via the workflow-run kk-solo-podcast profile; confirm YAML + both sidecars exist at the destination. (R1)
2. Launch the dry-path run with the frozen var set; capture the transcript. (R2)
3. Assert artifacts + validator exit 0 + docs.json (R3) and duration path (R4).
4. Simulate the revise guard at unit level; confirm counter path + retry edge. (R5)
5. Write ## Testing with the evidence table; `bun run lint && bun run test`. (R6)
6. Verify: `spur task check 0079 --json` pass; then `/sp-dev-verifyall --feature F7` for the map-close gate.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
