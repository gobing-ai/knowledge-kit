---
schema_version: 1
name: "Rewrite kk-solo-podcast workflow to invoke kk:audio-authoring"
status: done
template: feature-impl
created_at: 2026-08-23T23:37:50.753Z
updated_at: "2026-08-24T02:01:48.646Z"
feature_id: F7
dependencies: ["0077"]
---

## 0078. Rewrite kk-solo-podcast workflow to invoke kk:audio-authoring

### Background

<!-- Why this task exists: the problem, motivation, and context. Self-contained — readable without the parent. -->

### Requirements
- [x] R1. Rewrite the three `agent.run` nodes of `plugins/kk/workflows/kk-solo-podcast.yaml` to invoke `kk:audio-authoring` per 0075 §5: `understand` → op `briefing`; `outline-write` → op `outline`; `script-write` → op `script` with `--revise "${vars.__hitlInput}"`. State ids, `role: scribe`, `expectFile` values, and all HITL gates stay unchanged.
- [x] R2. Fix the revise-count brittleness (0076 P1-1): counter moves from `.spur/run/$run_id-solo-revise-count` to `${vars.work_dir}/.revise-count`; `prepare` resets it to 0; the two budget guards at `script-review` read the new path (`__runId` var and its fallback logic deleted).
- [x] R3. Extract the `wrap-docs` inline `bun -e` script (0076 P1-2) into `plugins/kk/workflows/wrap-voicescript-doc.ts` (Node/Bun builtins only, same constraint as `validate-voicescript.ts`); the workflow resolves it via the same fallback chain as `validate_script` (new var `wrap_script`, `$KK_WORKFLOWS_DIR/wrap-voicescript-doc.ts`, `$HOME/.config/kk/workflows/wrap-voicescript-doc.ts`).
- [x] R4. Add `wrap-voicescript-doc.ts` to the workflow-run sidecar copy list in `plugins/kk/commands/workflow-run.md` (kk-solo-podcast profile, `cp "$sdir/$side" "$ddir/$side"` loop) so the two-root install copies it beside the YAML.
- [x] R5. Consolidate duration-check (0076 P1-3): move the band check into `duration-check` `onEnter` shell writing `${vars.work_dir}/4-audio/.duration-ok` on pass; the two transition guards reduce to marker presence/absence; on miss route `duration-check → script-write` (with duration feedback in `__hitlInput`) while the revise budget allows, else `failed`. Missing `content.json` (dry-run) still passes.
- [x] R6. Update `apps/cli/tests/kk-solo-podcast-workflow.test.ts` invariants: agent.run blocks now reference the skill (keep the no-`skill:`-option invariant — invocation is via `input:` text); add assertions for `wrap-voicescript-doc.ts`, `.revise-count` under work_dir, `.duration-ok` marker; update `apps/cli/tests/workflow-run-command.test.ts` sidecar expectations.
- [x] R7. Same-commit doc sync (T3): `docs/design/kk-solo-podcast.md` satellite, its row in `docs/04_DESIGN.md`, `docs/help/solo-podcast-workflow.md` (CI/dry-run invocation documented per 0076 proposal 8), `docs/05_FEATURES.md` F7 row.
- [x] R8. `bun run lint` + `bun run test` green; `spur workflow validate plugins/kk/workflows/kk-solo-podcast.yaml` (or engine dry-run) passes.

**Non-goals:** changing `kk-daily-ai-voice.yaml`; tightening the duration band (0076 P3, deferred); touching `validate-voicescript.ts` or `voice-gen`; implementing the skill itself (0077).
```gherkin
Feature: kk-solo-podcast on kk:audio-authoring

  Scenario: Agent steps invoke the skill
    Given the rewritten plugins/kk/workflows/kk-solo-podcast.yaml
    When the understand, outline-write, and script-write nodes are inspected
    Then each agent.run input invokes kk:audio-authoring with the matching operation
    And role, agent var, expectFile, and all HITL gates are unchanged

  Scenario: P1 fixes landed
    When the workflow YAML is inspected
    Then the revise counter lives at ${vars.work_dir}/.revise-count and prepare resets it
    And wrap-docs shells plugins/kk/workflows/wrap-voicescript-doc.ts via the fallback chain
    And duration-check owns the band check in onEnter with a .duration-ok marker
    And a duration-check to script-write retry edge exists, bounded by the revise budget

  Scenario: Install and tests stay green
    When bun run lint and bun run test execute
    Then both pass including the updated workflow and workflow-run invariants
    And workflow-run copies wrap-voicescript-doc.ts beside the YAML on install
```
- **P1 proposal selection — assumed shipped:** 0076 P1 items 1–3 are included per their `ship` recommendation; the operator has not explicitly selected them. Descoping any is a one-line Requirements edit before implementation.
- **0076 P3 defers stay deferred** (band tightening, option-c guard, kk preflight) — recorded on map F7.
- **Open:** none blocking.

References: `docs/tasks/0075_…` (rewrite shape §5); `docs/tasks/0076_…` (P1 findings with evidence anchors); `plugins/kk/workflows/kk-solo-podcast.yaml`; `plugins/kk/workflows/validate-voicescript.ts` (helper constraint precedent); `plugins/kk/commands/workflow-run.md` (sidecar copy); `apps/cli/tests/kk-solo-podcast-workflow.test.ts`; `docs/design/kk-solo-podcast.md`.
**WHAT:** Rewrite `plugins/kk/workflows/kk-solo-podcast.yaml` onto the `kk:audio-authoring` skill (0077's frozen contract) plus the three 0076 P1 fixes, with tests and docs synced in the same commit.

**WHY:** F7 destination — the workflow becomes thin orchestration (HITL gates, validation, TTS) over skill invocations; the P1 fixes remove the brittleness found by the 0076 audit while the file is open.

**WHERE (frozen names):**
- `plugins/kk/workflows/kk-solo-podcast.yaml` — the rewrite target.
- `plugins/kk/workflows/wrap-voicescript-doc.ts` — NEW helper (constraint header copied from `validate-voicescript.ts`: builtins only, no `@gobing-ai/*`, SYNC note pointing at the workflow).
- `plugins/kk/commands/workflow-run.md` — sidecar list gains `wrap-voicescript-doc.ts`.
- Tests: `apps/cli/tests/kk-solo-podcast-workflow.test.ts`, `apps/cli/tests/workflow-run-command.test.ts`.
- Docs: `docs/design/kk-solo-podcast.md`, `docs/04_DESIGN.md` (row), `docs/help/solo-podcast-workflow.md`, `docs/05_FEATURES.md`.

**Node rewrite (0075 §5, frozen):** each `agent.run` keeps `role: scribe`, `agent: ${vars.agent}`, `expectFile` unchanged; `input:` becomes the skill invocation, e.g. script-write →

```yaml
input: |
  Invoke the kk:audio-authoring skill: operation `script`, mode `solo`.
  --dir ${vars.work_dir} --duration ${vars.target_duration_min}
  --language ${vars.language} --profile ${vars.voice_profile}
  --revise "${vars.__hitlInput}"
```

`understand` → op `briefing` (flags: `--dir`, `--duration`); `outline-write` → op `outline` (flags: `--dir`, `--duration`).

**P1 mechanics (frozen):**
- Revise counter: `${vars.work_dir}/.revise-count`; `prepare` writes `0`; `script-revise` increments; guards compare `< 3` / `>= 3` against it. `__runId` var deleted from `vars:`.
- Duration: `duration-check` `onEnter` computes the [0.5x, 2.0x] band from `${vars.target_duration_min}` against `jq -r '.metadata.duration'` of `4-audio/content.json`; pass (or missing content.json) → `touch 4-audio/.duration-ok`; miss → write feedback into a file the script-write prompt references via `__hitlInput`. Guards: `test -f .../.duration-ok` → done; else budget check → script-write or failed.
- Wrap helper: same resolution pattern as `validate_script` (var `wrap_script` → `$KK_WORKFLOWS_DIR` → `$HOME/.config/kk/workflows`).

**Precedence:** state ids and transition topology are preserved except the added `duration-check → script-write` edge; every other state keeps its current id so existing test invariants mostly hold.

**Anti-patterns:** no new workflow-engine features; no new states beyond what R5 lists; no behavior change to HITL prompts; don't fix P3 defers (band tightening, option-c guard, kk preflight).

**Assumes from deps (0077):** the skill's exact op names and flags — if 0077's shipped contract differs from R2/R3 there, 0077 wins and this task's prompts follow it. **Leaves for dependents (0079):** a runnable dry-run path (`script_approved=true`, `outline=a`) for e2e verification.
### Acceptance Criteria
```gherkin
Feature: kk-solo-podcast on kk:audio-authoring

  Scenario: Agent steps invoke the skill
    Given the rewritten plugins/kk/workflows/kk-solo-podcast.yaml
    When the understand, outline-write, and script-write nodes are inspected
    Then each agent.run input invokes kk:audio-authoring with the matching operation
    And role, agent var, expectFile, and all HITL gates are unchanged

  Scenario: P1 fixes landed
    When the workflow YAML is inspected
    Then the revise counter lives at ${vars.work_dir}/.revise-count and prepare resets it
    And wrap-docs shells plugins/kk/workflows/wrap-voicescript-doc.ts via the fallback chain
    And duration-check owns the band check in onEnter with a .duration-ok marker
    And a duration-check to script-write retry edge exists, bounded by the revise budget

  Scenario: Install and tests stay green
    When bun run lint and bun run test execute
    Then both pass including the updated workflow and workflow-run invariants
    And workflow-run copies wrap-voicescript-doc.ts beside the YAML on install
```
### Q&A
- **P1 proposal selection — assumed shipped:** 0076 P1 items 1–3 are included per their `ship` recommendation; the operator has not explicitly selected them. Descoping any is a one-line Requirements edit before implementation.
- **0076 P3 defers stay deferred** (band tightening, option-c guard, kk preflight) — recorded on map F7.
- **Open:** none blocking.

References: `docs/tasks/0075_…` (rewrite shape §5); `docs/tasks/0076_…` (P1 findings with evidence anchors); `plugins/kk/workflows/kk-solo-podcast.yaml`; `plugins/kk/workflows/validate-voicescript.ts` (helper constraint precedent); `plugins/kk/commands/workflow-run.md` (sidecar copy); `apps/cli/tests/kk-solo-podcast-workflow.test.ts`; `docs/design/kk-solo-podcast.md`.
### Design
**WHAT:** Rewrite `plugins/kk/workflows/kk-solo-podcast.yaml` onto the `kk:audio-authoring` skill (0077's frozen contract) plus the three 0076 P1 fixes, with tests and docs synced in the same commit.

**WHY:** F7 destination — the workflow becomes thin orchestration (HITL gates, validation, TTS) over skill invocations; the P1 fixes remove the brittleness found by the 0076 audit while the file is open.

**WHERE (frozen names):**
- `plugins/kk/workflows/kk-solo-podcast.yaml` — the rewrite target.
- `plugins/kk/workflows/wrap-voicescript-doc.ts` — NEW helper (constraint header copied from `validate-voicescript.ts`: builtins only, no `@gobing-ai/*`, SYNC note pointing at the workflow).
- `plugins/kk/commands/workflow-run.md` — sidecar list gains `wrap-voicescript-doc.ts`.
- Tests: `apps/cli/tests/kk-solo-podcast-workflow.test.ts`, `apps/cli/tests/workflow-run-command.test.ts`.
- Docs: `docs/design/kk-solo-podcast.md`, `docs/04_DESIGN.md` (row), `docs/help/solo-podcast-workflow.md`, `docs/05_FEATURES.md`.

**Node rewrite (0075 §5, frozen):** each `agent.run` keeps `role: scribe`, `agent: ${vars.agent}`, `expectFile` unchanged; `input:` becomes the skill invocation, e.g. script-write →

```yaml
input: |
  Invoke the kk:audio-authoring skill: operation `script`, mode `solo`.
  --dir ${vars.work_dir} --duration ${vars.target_duration_min}
  --language ${vars.language} --profile ${vars.voice_profile}
  --revise "${vars.__hitlInput}"
```

`understand` → op `briefing` (flags: `--dir`, `--duration`); `outline-write` → op `outline` (flags: `--dir`, `--duration`).

**P1 mechanics (frozen):**
- Revise counter: `${vars.work_dir}/.revise-count`; `prepare` writes `0`; `script-revise` increments; guards compare `< 3` / `>= 3` against it. `__runId` var deleted from `vars:`.
- Duration: `duration-check` `onEnter` computes the [0.5x, 2.0x] band from `${vars.target_duration_min}` against `jq -r '.metadata.duration'` of `4-audio/content.json`; pass (or missing content.json) → `touch 4-audio/.duration-ok`; miss → write feedback into a file the script-write prompt references via `__hitlInput`. Guards: `test -f .../.duration-ok` → done; else budget check → script-write or failed.
- Wrap helper: same resolution pattern as `validate_script` (var `wrap_script` → `$KK_WORKFLOWS_DIR` → `$HOME/.config/kk/workflows`).

**Precedence:** state ids and transition topology are preserved except the added `duration-check → script-write` edge; every other state keeps its current id so existing test invariants mostly hold.

**Anti-patterns:** no new workflow-engine features; no new states beyond what R5 lists; no behavior change to HITL prompts; don't fix P3 defers (band tightening, option-c guard, kk preflight).

**Assumes from deps (0077):** the skill's exact op names and flags — if 0077's shipped contract differs from R2/R3 there, 0077 wins and this task's prompts follow it. **Leaves for dependents (0079):** a runnable dry-run path (`script_approved=true`, `outline=a`) for e2e verification.
### Plan
1. Read 0077's shipped SKILL.md invocation contract; confirm op names/flags match 0075 §5 (0077 wins on conflict). (R1)
2. Create `plugins/kk/workflows/wrap-voicescript-doc.ts` by lifting the inline `bun -e` body verbatim; add the builtins-only SYNC header. (R3)
3. Rewrite `kk-solo-podcast.yaml`: three agent.run inputs (R1), revise-counter move + prepare reset + `__runId` removal (R2), wrap_docs → helper resolution (R3), duration-check onEnter + marker + new guards + `duration-check → script-write` edge (R5).
4. Add the sidecar to `plugins/kk/commands/workflow-run.md`. (R4)
5. Update the two test files; add new invariant assertions. (R6)
6. Sync the four docs in the same commit. (R7)
7. `bun run lint && bun run test`; validate the YAML loads (spur workflow validate or engine dry-run). (R8)
8. Verify: `spur task check 0078 --json` pass; Solution change-map lists every touched file.
### Solution
- `plugins/kk/workflows/kk-solo-podcast.yaml:1` — R1/R2/R3/R5: three agent.run inputs invoke `kk:audio-authoring` (operation briefing|outline|script, mode solo); `.revise-count` moved to work_dir, prepare resets it, `__runId` var deleted; wrap-docs resolves `wrap_script` (var → `$KK_WORKFLOWS_DIR/wrap-voicescript-doc.ts` → `$HOME/.config/kk/workflows`, fail-loud); duration-check onEnter band check writing `.duration-ok` on pass, `.duration-feedback` + `.revise-count++` on miss; guards carry the content.json term so `--dry-run` walks; `duration-check → script-write` retry edge with shared cap 3.
- `plugins/kk/workflows/wrap-voicescript-doc.ts:1` — R3: builtins-only sidecar (verbatim lift of the old `bun -e` body); `<scriptPath> <outPath> [voiceProfile]`; emits single-Doc DocListSchema JSON, id `sha256("file://"+absPath)[0:16]`, title `Podcast VoiceScript`, `metadata.voiceProfile` only when resolved; usage guard exits 1.
- `plugins/kk/commands/workflow-run.md:102` — R4: sidecar copy loop now ships both `validate-voicescript.ts` and `wrap-voicescript-doc.ts`; §5 kk-solo-podcast binds `wrap_script` in prose and the `--vars` JSON.
- `apps/cli/tests/kk-solo-podcast-workflow.test.ts:59` — R6: agent.run test asserts `kk:audio-authoring` + operation names in every block; duration test asserts the two `Regenerate:` strings, `.duration-ok`, `.duration-feedback`, and that the generate line lacks `--duration`; new test asserts `.revise-count` under work_dir, no `__runId`, no `.spur/run`, wrap helper exists/builtins-only/`Podcast VoiceScript`, `wrap_script not found`, retry edge `to: script-write`.
- `apps/cli/tests/workflow-run-command.test.ts:127` — R6: kk-solo-podcast profile test gains `wrap-voicescript-doc.ts` and `\"wrap_script\"` sidecar assertions.
- `docs/design/kk-solo-podcast.md:26` — R7: D3/D10 decisions, state list + transitions (duration retry-then-fail), vars table (`wrap_script` in, `__runId` out), works layout markers, §6 duration policy, §7 wrap-docs resolution chain, §8 prompt contract via skill, §10 static-test row, file inventory.
- `docs/help/solo-podcast-workflow.md:36` — R7: pieces table Wrapper row, state-writes rows for script-revise/wrap-docs/duration-check, vars `wrap_script`, duration policy retry-then-fail, daily-run sidecar list, file inventory.
- `docs/04_DESIGN.md:415` — R7: §7 sidecar sentence + §7.2 kk-solo-podcast profile row now name `wrap-voicescript-doc.ts`.
- `docs/05_FEATURES.md:81` — R7: F7 row added (status updated at close).
### Testing
- **Lint:** `bun run lint` — PASS. Biome 2.5.5 check across 130 files (0 findings), typecheck exit 0 across all 13 workspaces.
- **Unit tests:** `bun run test` — 470 pass / 0 fail / 1779 expect across 38 files. Scoped: `kk-solo-podcast-workflow.test.ts` (11) + `workflow-run-command.test.ts` (9) → 20 pass / 0 fail / 150 expect.
- **Coverage:** aggregate 98.13% line / 99.42% function (target 90% / 90%) — PASS with wide margin. `wrap-voicescript-doc.ts` is content-asserted (readFileSync), not imported, so outside instrumented coverage (accepted in the task plan).
- **Workflow validation:** `spur workflow validate plugins/kk/workflows/kk-solo-podcast.yaml` → `ok:true valid:true` exit 0. ADR-069 composition advisories (25-line duration-check onEnter, prompt char counts) are non-blocking warnings; no baseline disposition file has ever been tracked.
- **Dry-run walkability:** `spur workflow run plugins/kk/workflows/kk-solo-podcast.yaml --dry-run --vars '{"topic":"duration budget smoke","work_dir":"<mktemp>","outline":"a","script_approved":"true","target_duration_min":"1","voice_profile":"x","force":"true"}'` → `status: done` (all three duration-check guards evaluated without content.json; missing-content dry-run pass path per R5).
- **0077 baseline:** prior 469-test suite all passes within the 470 total; `validate-voicescript.test.ts` (9) and audio-authoring skill artifacts unaffected.

Verification (independent, subagent Verify0078): verdict **PASS** — all 8 requirements MET with file:line evidence (see `.spur/run/0078-verify-answer.txt` / `.spur/run/0078-verdict.json`).
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-24T01:03:38.362Z todo → wip (system)
- 2026-08-24T02:01:48.646Z wip → done (system)
