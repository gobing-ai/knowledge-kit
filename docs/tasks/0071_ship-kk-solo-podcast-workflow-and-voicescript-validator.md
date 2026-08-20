---
schema_version: 1
name: "Ship kk-solo-podcast workflow and VoiceScript validator"
status: done
template: feature-impl
created_at: 2026-08-20T05:48:49.463Z
updated_at: "2026-08-20T18:31:55.326Z"
feature_id: F5
priority: P2
---

## 0071. Ship kk-solo-podcast workflow and VoiceScript validator

### Background
Implements F5: given text plus a target duration becomes a Voicebox WAV by authoring a validated kk VoiceScript and invoking shipped D5 `voice-gen` via existing Spur `hitl.select` / `hitl.confirm` / `hitl.input` plus `agent.run`.

**Runtime vs design-time.** SSOT lives at `plugins/kk/workflows/` in the package/repo. Operators run `$HOME/.config/kk/workflows/kk-solo-podcast.yaml` after `/workflow-run` copies the YAML and `validate-voicescript.ts` there. `agent.run` inlines the VoiceScript contract — it does not load `docs/design/*` (not in the npm tarball).

No `plugins/kk/skills/solo-podcast/`. D5 `voice-gen` was not modified. `--dry-run` reaches `done` when `outline=a` and `script_approved=true`.
### Requirements
- [x] R1. Ship design-time `plugins/kk/workflows/kk-solo-podcast.yaml` (`name: kk-solo-podcast`, `kind: state-machine`, quoted `$schema`, frozen state ids). No `kind: action-ok`. No `solo-podcast.yaml` under `.spur/workflows/`.
- [x] R2. `prepare` XOR `topic`/`input_file`, mkdir layout, overwrite/`voice_profile` fail-loud (kk-itc strings).
- [x] R3. Three `agent.run` scribe steps with **inlined** VoiceScript contract (no `docs/design/` paths). Outline `hitl.select`; script `hitl.confirm` + cap-3 `hitl.input`. `script_approved=true` skips script-review.
- [x] R4. `script-validate` runs `bun $KK_WORKFLOWS_DIR/validate-voicescript.ts` (default `$HOME/.config/kk/workflows/validate-voicescript.ts`, builtins-only sidecar). `wrap-docs` writes `Doc[]`. `generate` is `kk executor run voice-gen` with optional `--plugins-path` only when `plugins_path` is non-empty. Duration-check 0.5×–2×; missing `content.json` succeeds (dry-run).
- [x] R5. Tests for YAML + helper. `/workflow-run kk-solo-podcast` copies YAML+sidecar into `$HOME/.config/kk/workflows` and runs `$dest`. No fat skill. No live Voicebox in CI.

Non-goals: MP3; duration flag on `voice-gen`; fat skill; new `hitl.*` kind; new `kk` noun; multi-host; publish; reopen D5.
### Acceptance Criteria
```gherkin
Feature: Solo-podcast workflow (voice-gen dogfood)

  @core
  Scenario: R1 — Product YAML lives at plugins/kk/workflows/kk-solo-podcast.yaml
    Given knowledge-kit product workflows live only under plugins/kk/workflows
    When F5 ships
    Then plugins/kk/workflows/kk-solo-podcast.yaml exists
    And its name is kk-solo-podcast and its kind is state-machine
    And no solo-podcast.yaml exists under .spur/workflows

  @core
  Scenario: R2 — Prepare XOR topic or input_file into a works layout
    Given a topic sentence XOR a markdown input file and a work_dir
    When the prepare state runs
    Then work_dir/brief.md is written from exactly one of those inputs
    And the briefing, outline, script, and audio subdirectories exist
    And setting both inputs or neither fails with a named XOR recovery

  @core
  Scenario: R3 — Outline HITL is hitl.select unless outline is pre-set
    Given outline-option-a.md and outline-option-b.md exist under work_dir/2-outline
    When vars.outline is empty
    Then outline-select pauses with hitl.select over a, b, and c
    And the chosen file is copied to outline-approved.md
    And when vars.outline is set, outline-select is skipped and that option is committed

  @core
  Scenario: R4 — Approved outline becomes a validated VoiceScript
    Given an approved outline, target_duration_min, and a resolvable voice_profile
    When script-write and script-validate run
    Then work_dir/3-script/voicescript.yaml is a VoiceScript with a non-empty segments array
    And validateVoiceScript accepts it
    And the spoken budget is derived from target_duration_min (words for space-delimited languages, characters for CJK)

  @core
  Scenario: R5 — Script HITL gates live TTS
    Given a validated VoiceScript
    When script-review runs
    Then the operator hitl.confirm the script before generate
    And a rejected script can be revised via hitl.input at most three times

  @core
  Scenario: R6 — Generate invokes voice-gen and writes sibling WAV
    Given an approved VoiceScript
    When generate runs
    Then kk executor run voice-gen is invoked with Doc[] --in and Content --out
    And the Content has format audio
    And a sibling .wav exists at metadata.audioPath

  @core
  Scenario: R7 — Target length is a script budget and a duration post-check
    Given vars.target_duration_min and an approved VoiceScript
    When generate writes content.json
    Then the workflow does not pass a duration field to voice-gen
    And the run reads metadata.duration from content.json
    And a value below 0.5 times or above 2 times the target seconds fails the run

  @core
  Scenario: R8 — No new skill, HITL kind, or kk noun
    Given the F5 delivery
    When the repository is inspected
    Then agent.run steps use input and role only
    And only hitl.select, hitl.confirm, and hitl.input appear
    And no new kk first-layer noun is added
    And no plugins/kk/skills/solo-podcast directory exists

  @core
  Scenario: R11 — Runtime dest is ~/.config/kk/workflows
    Given /workflow-run kk-solo-podcast
    When it installs the machine
    Then dest is $HOME/.config/kk/workflows/kk-solo-podcast.yaml
    And validate-voicescript.ts is copied beside it
    And spur workflow run uses that dest
    And agent.run does not load docs/design paths

  @edge
  Scenario: R9 — Missing or unsafe inputs fail loud
    Given both topic and input_file set, or neither, or an empty voice_profile without VOICEBOX_DEFAULT_PROFILE, or invalid VoiceScript YAML
    When the corresponding state runs
    Then the run stops with a named recovery
    And generate is not invoked

  @edge
  Scenario: R10 — Existing brief.md is not overwritten without force
    Given work_dir/brief.md already exists
    When prepare runs with force not equal to true
    Then the run fails naming the path
    And the existing file is unchanged
```
### Q&A
- **Q: Helper under `scripts/` like `render-md.ts`?** A: No. Isolation forbids `@gobing-ai/*` and `../../generations` after copy to the runtime dest. Design-time path is `plugins/kk/workflows/validate-voicescript.ts`; runtime dest is `$KK_WORKFLOWS_DIR/validate-voicescript.ts` (default `$HOME/.config/kk/workflows`).
- **Q: Add `--validate` to `voice-gen`?** A: No. D5 contract stays `Doc[] --in` → `Content --out`.
- **Q: `/workflow-run kk-solo-podcast` in this task?** A: Yes. Copies YAML + sidecar into `$HOME/.config/kk/workflows` and runs `$dest`. Design-time SSOT stays `plugins/kk/workflows/`. Operators never `spur workflow run` the package path. `agent.run` inlines the VoiceScript contract (no `docs/design/`; docs are not in the npm tarball).
- **Q: Fat `solo-podcast` skill?** A: No.
- **Q: How does `--dry-run` reach `done`?** A: Pass `outline=a` (skip outline-select) and `script_approved=true` (skip script-review). Engine still pauses on `pause: true` without those skips. `duration-check` treats missing `content.json` as success.
- **Q: Outline option c required?** A: No. a and b required.
- **Q: New ADR / 03 / README file list?** A: No. Extends ADR-009 + D5 + F4. Live inventory is `04` §0. `04` §7 lists the `/workflow-run` profile. `plugins/kk/README.md` notes design-time vs runtime dest.
- **Q: MP3?** A: No. D5 sibling WAV only.
- **Q: Task R-items vs feature scenarios?** A: Task-local R1–R5. Feature AC is R1–R11. Mapping: R1 → feature R1; R2 → R2+R9+R10; R3 → R3+R5; R4 → R4+R6+R7; R5 → R8 tests/invariants + R11 runtime dest + dry-run.
- **Q: Anything deferred?** A: Fat skill, MP3, multi-host, live CI Voicebox — F5 Out. No open implement decision.
### Design
**WHAT.** Design-time YAML + builtins-only checker under `plugins/kk/workflows/`. Runtime dest `$HOME/.config/kk/workflows/` (copy via `/workflow-run`). Last mile `kk executor run voice-gen` (ADR-012). VoiceScript contract inlined in `agent.run`.

**WHY.** `docs/design/` and checkout `plugins/kk/lib/` are not on the operator runtime path. The npm tarball ships `plugins/`. `/workflow-run` copies YAML+sidecar into `KK_WORKFLOWS_DIR`.

**WHERE.**

| Path | Role |
| --- | --- |
| `plugins/kk/workflows/kk-solo-podcast.yaml` | design-time SSOT |
| `plugins/kk/workflows/validate-voicescript.ts` | design-time checker (no `@gobing-ai/*`) |
| `$HOME/.config/kk/workflows/` | runtime dest for both files |
| `plugins/generations/voice-gen/` | tarball generator |

**Anti-patterns.** `agent.run` loading `docs/design/*`. Helper importing `../../generations`. Hardcoded `./plugins` as required `--plugins-path`. `spur workflow run` of the design-time path as the operator dest.
### Plan
1. Helper at `plugins/kk/workflows/validate-voicescript.ts` (builtins-only, SYNC with voice-gen) + `apps/cli/tests/validate-voicescript.test.ts` including a copy-into-temp-workflows_dir case.
2. YAML `plugins/kk/workflows/kk-solo-podcast.yaml` from frozen ids/vars/transitions (`script_approved` skip included). `agent.run` inlines the VoiceScript contract. `script-validate` resolves `${KK_WORKFLOWS_DIR:-$HOME/.config/kk/workflows}/validate-voicescript.ts`.
3. Static tests `apps/cli/tests/kk-solo-podcast-workflow.test.ts` (no `docs/design`, no `plugins/kk/workflows` as a runtime path).
4. `/workflow-run kk-solo-podcast` copies YAML+sidecar into `$HOME/.config/kk/workflows` and runs `$dest`. Tests: `apps/cli/tests/workflow-run-command.test.ts`.
5. `spur workflow validate` of the design-time SSOT. Dry-run of the runtime dest with `outline=a` and `script_approved=true` reaches `done`.
6. Same commit T3/T9: satellite + `04` §0/§6 **shipped (F5)** + `04` §7 runner profile.
7. Optional local Voicebox dogfood — not CI.

Verification: `bun test apps/cli/tests/kk-solo-podcast-workflow.test.ts apps/cli/tests/validate-voicescript.test.ts apps/cli/tests/workflow-run-command.test.ts` plus step 5.
### Solution
| Change | Evidence |
| --- | --- |
| Product YAML `name: kk-solo-podcast` | `plugins/kk/workflows/kk-solo-podcast.yaml:3` |
| `script_approved` var | `plugins/kk/workflows/kk-solo-podcast.yaml:20` |
| Runtime helper fallback `$KK_WORKFLOWS_DIR` | `plugins/kk/workflows/kk-solo-podcast.yaml:161` |
| Missing-helper recovery names `/workflow-run` dest | `plugins/kk/workflows/kk-solo-podcast.yaml:165` |
| `script_approved=true` skip to wrap-docs | `plugins/kk/workflows/kk-solo-podcast.yaml:296` |
| `hitl.select` outline pause | `plugins/kk/workflows/kk-solo-podcast.yaml:104` |
| `kk executor run voice-gen` | `plugins/kk/workflows/kk-solo-podcast.yaml:233` |
| duration-check missing-file success | `plugins/kk/workflows/kk-solo-podcast.yaml:352` |
| builtins-only helper (runtime dest comment) | `plugins/kk/workflows/validate-voicescript.ts:6` |
| `/workflow-run kk-solo-podcast` sidecar copy | `plugins/kk/commands/workflow-run.md:104` |
| Workflow static tests | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:14` |
| Helper tests | `apps/cli/tests/validate-voicescript.test.ts:14` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/workflows/kk-solo-podcast.yaml:3` |
| R2 | MET | `plugins/kk/workflows/kk-solo-podcast.yaml:46` |
| R3 | MET | `plugins/kk/workflows/kk-solo-podcast.yaml:104` |
| R4 | MET | `plugins/kk/workflows/kk-solo-podcast.yaml:161` |
| R5 | MET | `apps/cli/tests/workflow-run-command.test.ts:127` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Product YAML lives at plugins/kk/workflows/kk-solo-podcast.yaml | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:41` |
| R2 — Prepare XOR topic or input_file into a works layout | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:79` |
| R3 — Outline HITL is hitl.select unless outline is pre-set | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:48` |
| R4 — Approved outline becomes a validated VoiceScript | MET | test | `apps/cli/tests/validate-voicescript.test.ts:14` |
| R5 — Script HITL gates live TTS | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:49` |
| R6 — Generate invokes voice-gen and writes sibling WAV | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:93` |
| R7 — Target length is a script budget and a duration post-check | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:89` |
| R8 — No new skill, HITL kind, or kk noun | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:127` |
| R9 — Missing or unsafe inputs fail loud | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:80` |
| R10 — Existing brief.md is not overwritten without force | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:81` |
| R11 — Runtime dest is ~/.config/kk/workflows | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:103` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECUA Code Review**

1. **Security**:
   - XOR prepare, overwrite guard, and VoiceScript checker fail loud before `kk executor run voice-gen`.
   - Helper is builtins-only (`node:fs` / `node:util`); no `@gobing-ai/*` import after copy into `$HOME/.config/kk/workflows`.

2. **Error Handling**:
   - Named recoveries: `missing work_dir`, XOR violations, `missing voice_profile`, existing `brief.md`, missing helper (`/workflow-run kk-solo-podcast` into `$HOME/.config/kk/workflows`), duration-check band.

3. **Correctness & Contract Adherence**:
   - Design-time SSOT is `plugins/kk/workflows/`; runtime dest is `$KK_WORKFLOWS_DIR` / `$HOME/.config/kk/workflows`.
   - `agent.run` inlines the VoiceScript contract — no `docs/design/` loads (docs are not in the npm tarball).
   - `/workflow-run kk-solo-podcast` copies YAML + `validate-voicescript.ts` and runs `$dest`.

4. **Maintainability & Simplicity**:
   - No fat `solo-podcast` skill, no new `hitl.*` kind, no new `kk` noun (ADR-011).
   - Sidecar copy is name-gated so other profiles do not install the checker.

**Priority Findings**

| Priority | Finding | File:Line | Disposition |
| -------- | ------- | --------- | ----------- |
| P4 | Runtime dest vs design-time SSOT is now explicit in YAML, `/workflow-run`, help, and tests. | `plugins/kk/workflows/kk-solo-podcast.yaml:161` | Accepted |

**Traceability Matrix (P1–P4)**

| Req | Description | Implementation File | Test File & Case | Verdict |
| --- | ----------- | ------------------- | ---------------- | ------- |
| R1 | State machine product YAML | `plugins/kk/workflows/kk-solo-podcast.yaml` | `apps/cli/tests/kk-solo-podcast-workflow.test.ts` (R1) | **PASS** |
| R2 | Prepare XOR and works layout | `plugins/kk/workflows/kk-solo-podcast.yaml` | `apps/cli/tests/kk-solo-podcast-workflow.test.ts` (R2) | **PASS** |
| R3 | HITL + inlined VoiceScript `agent.run` | `plugins/kk/workflows/kk-solo-podcast.yaml` | `apps/cli/tests/kk-solo-podcast-workflow.test.ts` (R3) | **PASS** |
| R4 | Runtime helper + voice-gen invoke | `plugins/kk/workflows/validate-voicescript.ts` | `apps/cli/tests/validate-voicescript.test.ts` | **PASS** |
| R5 | Tests + `/workflow-run` dest copy | `plugins/kk/commands/workflow-run.md` | `apps/cli/tests/workflow-run-command.test.ts` | **PASS** |
### References
- Feature: [F5_solo-podcast-workflow-voice-gen-dogfood.md](../features/F5_solo-podcast-workflow-voice-gen-dogfood.md)
- Satellite: [kk-solo-podcast.md](../design/kk-solo-podcast.md) (maintainer-only; not a runtime input)
- Help: [solo-podcast-workflow.md](../help/solo-podcast-workflow.md)
- Voice generator: [voice-gen.md](../design/voice-gen.md) · plugin `plugins/generations/voice-gen/` (D5, in the npm tarball)
- Clone grain: [kk-itc.yaml](../../plugins/kk/workflows/kk-itc.yaml) · [kk-itc-workflow.test.ts](../../apps/cli/tests/kk-itc-workflow.test.ts) (F4 / 0069)
- Isolation: [.spur/rules/boundary/shipped-script-isolation.yaml](../../.spur/rules/boundary/shipped-script-isolation.yaml)
- Runner: [workflow-run.md](../../plugins/kk/commands/workflow-run.md) (`kk-solo-podcast` profile copies YAML + sidecar into `$HOME/.config/kk/workflows`)
- ADR-009 product YAML home; ADR-011 no new `kk` noun — `docs/00_ADR.md`
- Doc contract: `packages/kk-core/src/schemas.ts` (`DocSchema`)
- Idea eval: `.spur/run/idea-eval-report.md` · brainstorm `docs/plans/2026-08-19-solo-podcast-brainstorm.md`
### History
- 2026-08-20T06:20:08.677Z todo → wip (system)
- 2026-08-20T06:22:27.919Z wip → testing (system)
- 2026-08-20T06:22:49.218Z testing → done (system)
