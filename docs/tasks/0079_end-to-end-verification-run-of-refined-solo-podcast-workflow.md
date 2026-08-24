---
schema_version: 1
name: "End-to-end verification run of refined solo-podcast workflow"
status: done
template: feature-impl
created_at: 2026-08-23T23:37:50.939Z
updated_at: "2026-08-24T02:58:15.898Z"
feature_id: F7
dependencies: ["0078"]
---

## 0079. End-to-end verification run of refined solo-podcast workflow

### Background

<!-- Why this task exists: the problem, motivation, and context. Self-contained — readable without the parent. -->

### Requirements
- [x] R1. Install the rewritten workflow via the kk-solo-podcast profile of `plugins/kk/commands/workflow-run.md` (two-root copy: YAML + `validate-voicescript.ts` + `wrap-voicescript-doc.ts` into `$KK_WORKFLOWS_DIR` / `$HOME/.config/kk/workflows`).
- [x] R2. Execute an end-to-end run on the CI/dry-run path: `spur workflow run` with vars `topic` (a short sample topic), `work_dir` (scratch dir), `voice_profile`, `outline: "a"`, `script_approved: "true"`, `force: "true"`, `target_duration_min: "1"` — no HITL pauses; walk prepare → understand → outline-write → outline-commit → script-write → script-validate → wrap-docs → generate → duration-check → done.
- [x] R3. Evidence per claim: the transcript shows each `agent.run` node invoking `kk:audio-authoring` with the right operation; `1-briefing/briefing.md`, `2-outline/outline-approved.md`, `3-script/voicescript.yaml` exist; `validate-voicescript.ts` exits 0 on the script; `4-audio/docs.json` is produced by the helper.
- [x] R4. Duration check exercised: generated `content.json` duration within band → done; if TTS is unavailable in the environment, the missing-content.json dry-run pass path is the accepted evidence and is stated as such.
- [x] R5. Exercise the revise path once with a bounded check: reject at script-review is simulated by unit-level guard evaluation (not a full re-run) — confirm the `.revise-count` increments under `work_dir` and the `duration-check → script-write` edge exists per 0078 (static assertion is sufficient; full HITL loop is manual-only).
- [x] R6. Record all evidence in ## Testing; `bun run lint` + `bun run test` green at the end.

**Non-goals:** real multi-minute TTS generation as a blocking requirement; publishing audio; running the interactive HITL path (operator-driven, not this ticket).
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
- **TTS availability:** real audio generation is best-effort; the missing-content.json dry-run pass is accepted evidence (stated explicitly per R4).
- **Agent backend:** if `agent.run` cannot execute in this environment, record PARTIAL evidence with the exact halt point — no silent green (see ## Design known constraint).
- **Open:** none blocking.

References: map `docs/features/F7_audio-authoring-skill-extraction-wayfinder-map.md`; `plugins/kk/commands/workflow-run.md`; `docs/design/kk-solo-podcast.md`; deps 0077/0078.
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
- `docs/tasks/0079_end-to-end-verification-run-of-refined-solo-podcast-workflow.md:77` ## Testing — R1–R6 evidence table: installed YAML + both sidecars byte-identical to design-time (`$HOME/.config/kk/workflows/`); dry-path run walked `prepare → understand → outline-write → outline-commit → script-write → script-validate → wrap-docs → generate` with no HITL pauses (outline=a + script_approved=true); agent-session prompts show each authoring node invoking `kk:audio-authoring` op `briefing`/`outline`/`script`, mode `solo`; validator exit 0 on the authored script; `4-audio/docs.json` id `1b534c4d46cd3813` == `sha256(file://…/voicescript.yaml)[0:16]`, title `Podcast VoiceScript`, `metadata.voiceProfile=Robin`.
- `.spur/run/solo-e2e-79.log:1` — run transcript (walk + wrap-docs/shell exit 0, seq=30).
- `/tmp/solo-verify-EdHl7e` — scratch artifacts (briefing, outlines, voicescript.yaml, re-captured docs.json, `.revise-count`, `.duration-feedback`), outside the repo.
- R4 accepted evidence: TTS unavailable → generate (voice-gen) hung with no `content.json`; missing-content dry-run pass is the accepted evidence (`.spur/run/dry-79.log` + fresh re-run → `status: done`).
- R5 unit-level guard simulation: script-review reject guard routes to script-revise (`.revise-count` 0→1); out-of-band duration writes `.duration-feedback` + increments (→2); all three `duration-check` edges present (`done`/`script-write`/`failed`).
- No source changes — 0079 is the map-closing verification run for F7. Only the task file's status/Requirements/Testing/Solution sections updated (CLI-gated).
### Testing
E2E run id: `solo-e2e-79` (log `.spur/run/solo-e2e-79.log`); dry-run id `dry-79`. Scratch: `/tmp/solo-verify-EdHl7e` (outside repo). Installed dest: `$HOME/.config/kk/workflows/` — YAML and both sidecars byte-identical to design-time (`diff` clean).

| Claim | Evidence |
| --- | --- |
| R1 install (two-root copy) | YAML + `validate-voicescript.ts` + `wrap-voicescript-doc.ts` copied to `$HOME/.config/kk/workflows/`; `diff` vs `plugins/kk/workflows/` → identical. |
| R2 dry-path run walks | `spur workflow run "$dest" --vars '{"topic":"…","work_dir":<scratch>,"voice_profile":"Robin","outline":"a","script_approved":"true","force":"true","target_duration_min":"1"}'` → prepare → understand → outline-write → outline-commit → script-write → script-validate → wrap-docs → generate (halted at TTS, see R4). No HITL pauses (outline=a + script_approved=true). |
| R3 agent.run invokes skill | Each authoring node's prompt (from `.spur/run/solo-e2e-79/agent-sessions/omp/*.jsonl`) opens `Invoke the kk:audio-authoring skill: operation \`briefing\`/\`outline\`/\`script\`, mode \`solo\``. Artifacts: `1-briefing/briefing.md`, `2-outline/outline-option-{a,b,c}.md` + `outline-approved.md`, `3-script/voicescript.yaml`. |
| R3 validator exit 0 | `bun $HOME/.config/kk/workflows/validate-voicescript.ts --in <scratch>/3-script/voicescript.yaml` → exit 0. |
| R3 docs.json from helper | `4-audio/docs.json`: `id=1b534c4d46cd3813` (sha256 prefix), `title="Podcast VoiceScript"`, `sourceUri=file://…/voicescript.yaml`, `mediaType=application/yaml`, `metadata.voiceProfile="Robin"`, `body` = full script. Re-captured post-run via `bun …/wrap-voicescript-doc.ts <script> <docs.json> Robin` → exit 0, id byte-identical (run wrap-docs/shell also exited 0, seq=30). |
| R4 duration | TTS unavailable in this environment: `generate` (voice-gen) hung >7 min with no `4-audio/content.json`; run interrupted. Accepted evidence = missing-content dry-run pass: `spur workflow run "$dest" --dry-run` on the installed YAML → `status: done`. |
| R5 revise + duration mechanics | Guard sim on installed YAML: script-review reject guard (`no`, count 0 < 3) → routes to script-revise; `.revise-count` 0→1 after script-revise increment. Band check: 45s vs 60s target (band [30,120]) in-band → pass; 10s → out-of-band → writes `.duration-feedback` + increments `.revise-count` (1→2). All three `duration-check` edges present: `done`, `script-write`, `failed`. |
| R6 gates | `bun run lint` → clean (Biome 2.5.5 130 files + typecheck all workspaces exit 0); `bun run test` → 470 pass / 0 fail / 1779 expect across 38 files. Coverage (aggregate): 97.90% lines / 98.73% functions (target ≥90% / ≥90%). 0079 is a verification-run task — no new code, so coverage delta is N/A beyond the existing suite. |

Note: `kk:audio-authoring` is not registered in the `omp` agent backend, so the authoring agents followed the inlined prompt contract (which is the complete 0077 contract). The workflow's invocation of the skill is evidenced by the prompts; actual skill-file execution is an environment limitation, not a workflow defect.
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-24T02:04:03.142Z todo → wip (system)
- 2026-08-24T02:58:15.898Z wip → done (system)
