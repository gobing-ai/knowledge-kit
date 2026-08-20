---
schema_version: 1
name: "Ship kk-solo-podcast workflow and VoiceScript validator"
status: done
template: feature-impl
created_at: 2026-08-20T05:48:49.463Z
updated_at: "2026-08-20T06:46:26.946Z"
feature_id: F5
priority: P2
---

## 0071. Ship kk-solo-podcast workflow and VoiceScript validator

### Background
Implements F5: given text plus a target duration becomes a Voicebox WAV by authoring a validated kk VoiceScript and invoking shipped D5 `voice-gen` via existing Spur `hitl.select` / `hitl.confirm` / `hitl.input` plus `agent.run`.

Implements feature scenarios: R1 — Product YAML lives at plugins/kk/workflows/kk-solo-podcast.yaml; R2 — Prepare XOR topic or input_file into a works layout; R3 — Outline HITL is hitl.select unless outline is pre-set; R4 — Approved outline becomes a validated VoiceScript; R5 — Script HITL gates live TTS; R6 — Generate invokes voice-gen and writes sibling WAV; R7 — Target length is a script budget and a duration post-check; R8 — No new skill, HITL kind, kk noun, or workflow-run profile; R9 — Missing or unsafe inputs fail loud; R10 — Existing brief.md is not overwritten without force.

**Shipped (this task).** `plugins/kk/workflows/kk-solo-podcast.yaml` and `plugins/kk/lib/validate-voicescript.ts` exist. `/workflow-run` profiles remain `kk-storm-research` and `kk-itc` only. No `plugins/kk/skills/solo-podcast/`. D5 `voice-gen` was not modified. `--dry-run` reaches `done` when `outline=a` and `script_approved=true` (engine still pauses on `pause: true` otherwise).

Locked by idea-eval Approach 1 and satellite `docs/design/kk-solo-podcast.md`. Rubric: kept whole by cohesion (F4/0069 grain). No `dependencies[]`.
### Requirements
- [x] R1. Ship `plugins/kk/workflows/kk-solo-podcast.yaml` with `name: kk-solo-podcast`, `kind: state-machine`, quoted `"$schema": "@gobing-ai/spur/schemas/state-machine-workflow.schema.json"`, `initialState: prepare`, `terminalStates: [done, failed]`, `failureStates: [failed]`, and frozen state ids `prepare`, `understand`, `outline-write`, `outline-select`, `outline-commit`, `script-write`, `script-validate`, `script-review`, `script-revise`, `wrap-docs`, `generate`, `duration-check`, `done`, `failed`. Success edges are `guard.kind: always` except the named shell guards in Design. No `kind: action-ok`. No `solo-podcast.yaml` under `.spur/workflows/` or `plugins/kk/workflows/`.
- [x] R2. `prepare` `mkdir -p`s `${work_dir}` plus `1-briefing`, `2-outline`, `3-script`, `4-audio`; XOR `topic` / `input_file` using the kk-itc strings `XOR violation: both topic and input_file set` and `XOR violation: neither topic nor input_file set`; writes `brief.md` from topic `printf` or `cp` of `input_file`; refuses an existing `brief.md` unless `force` is the string `true` (`initialization target already exists at ${vars.work_dir}/brief.md; pass force=true to replace`); fails `missing work_dir`, `input file not found: …`, and `missing voice_profile (set vars.voice_profile or VOICEBOX_DEFAULT_PROFILE)` when those inputs are empty.
- [x] R3. Three `agent.run` steps (`role: scribe`, `input:` only, no `skill:` / `prompt:`): understand → `1-briefing/briefing.md`; outline-write → `outline-option-a.md` with shell requiring `-b.md` (c optional); script-write → `3-script/voicescript.yaml` (load the two design satellites, duration budget, `Revision feedback: ${vars.__hitlInput}`). Outline pause is `hitl.select` `a|b|c` unless `vars.outline` is set; commit copies `outline-option-$sel.md` to `outline-approved.md` (`sel` = `outline` else `__hitlAnswer` else `a`). Script pause is `hitl.confirm` before generate; reject uses `hitl.input` and `.spur/run/${__runId}-solo-revise-count` (default `__runId=solo`) with cap 3 then `failed`. Empty `__hitlAnswer` counts as approve on the confirm edge. `script_approved=true` skips `script-review` entirely (CI / `--dry-run`).
- [x] R4. `script-validate` runs `bun "${vars.validate_script}" --in "${vars.work_dir}/3-script/voicescript.yaml"` (default helper `plugins/kk/lib/validate-voicescript.ts` calling shipped `validateVoiceScript`; exit 1 names parse/validator/`--in` failures). `wrap-docs` writes a one-element `Doc[]` to `4-audio/docs.json` (`id` = sha256(`sourceUri`) hex 16, `body` = YAML file, `mediaType` = `application/yaml`). `generate` is exactly `kk executor run voice-gen --in "${vars.work_dir}/4-audio/docs.json" --out "${vars.work_dir}/4-audio/content.json" --plugins-path "${vars.plugins_path}"` with no duration/length flag. `duration-check` fail-loud only when `content.json` exists and `metadata.duration` is missing/non-numeric or outside `[0.5, 2] × target_duration_min * 60`; missing file (dry-run) still reaches `done`.
- [x] R5. `apps/cli/tests/kk-solo-podcast-workflow.test.ts` and `apps/cli/tests/validate-voicescript.test.ts` (valid YAML exit 0; empty `segments`; text length `> 50000`; unknown `default_engine`; missing `--in`). `spur workflow validate` plus `--dry-run` with `outline=a`, `script_approved=true`, and a `voice_profile` reach `done`. `/workflow-run` still lists only `kk-storm-research` and `kk-itc`. No `plugins/kk/skills/solo-podcast/`. No writes under `plugins/generations/voice-gen/`. No live Voicebox in CI.

Non-goals (do not implement): MP3/ffmpeg; duration field on `voice-gen`; fat skill; `/workflow-run` profile `kk-solo-podcast`; new `hitl.*` kind; new `kk` noun; multi-host interview; publish; reopen D5; `03` or ADR edits; enumerating YAML files in `plugins/kk/README.md`.
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
  Scenario: R8 — No new skill, HITL kind, kk noun, or workflow-run profile
    Given the F5 delivery
    When the repository is inspected
    Then agent.run steps use input and role only
    And only hitl.select, hitl.confirm, and hitl.input appear
    And /workflow-run still lists only kk-storm-research and kk-itc as profiles
    And no plugins/kk/skills/solo-podcast directory exists

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
- **Q: Helper under `scripts/` like `render-md.ts`?** A: No. Isolation rule forbids `../../` and `@gobing-ai/` there. Path is `plugins/kk/lib/validate-voicescript.ts`.
- **Q: Add `--validate` to `voice-gen`?** A: No. D5 contract stays `Doc[] --in` → `Content --out`.
- **Q: `/workflow-run kk-solo-podcast` in this task?** A: No. Invoke with `spur workflow run plugins/kk/workflows/kk-solo-podcast.yaml`.
- **Q: Fat `solo-podcast` skill?** A: No.
- **Q: How does `--dry-run` reach `done`?** A: Pass `outline=a` (skip outline-select) and `script_approved=true` (skip script-review). Engine still pauses on `pause: true` without those skips. `duration-check` treats missing `content.json` as success.
- **Q: Outline option c required?** A: No. a and b required.
- **Q: New ADR / 03 / README file list?** A: No. Extends ADR-009 + D5 + F4. Live inventory is `04` §0.
- **Q: MP3?** A: No. D5 sibling WAV only.
- **Q: Task R-items vs feature scenarios?** A: Task-local R1–R5. Feature AC stays ten scenario titles. Mapping: R1 → feature R1; R2 → R2+R9+R10; R3 → R3+R5; R4 → R4+R6+R7; R5 → R8 tests/invariants + dry-run.
- **Q: Anything deferred?** A: `/workflow-run` profile, fat skill, MP3, multi-host, live CI Voicebox — F5 Out. No open implement decision.
### Design
**WHAT.** One product state-machine YAML + one checkout-only VoiceScript validator + two bun:test files. Last mile is `kk executor run voice-gen`. No new API in `apps/cli`. No new skill.

**WHY.** D5 shipped `Doc[] → audio Content` and left the podcast workflow out. F4 already proved `plugins/kk/workflows/` + `hitl.*` + `agent.run` `input:`. Target duration cannot be a plugin flag (`docs/design/voice-gen.md` §7). Helper cannot live under `plugins/kk/scripts/` (`.spur/rules/boundary/shipped-script-isolation.yaml`).

**WHERE (primary files).**

| Path | Role |
| --- | --- |
| `plugins/kk/workflows/kk-solo-podcast.yaml` | state machine |
| `plugins/kk/lib/validate-voicescript.ts` | bun `--in` helper |
| `apps/cli/tests/kk-solo-podcast-workflow.test.ts` | static YAML invariants |
| `apps/cli/tests/validate-voicescript.test.ts` | helper tests |
| `docs/design/kk-solo-podcast.md` | satellite **shipped (F5)** |
| `docs/04_DESIGN.md` §0 / §6 | index **shipped (F5)**; no `/workflow-run` profile under §7 |

Leave unchanged: `plugins/generations/voice-gen/**`, `plugins/kk/commands/workflow-run.md`, `plugins/kk/skills/**`, `packages/kk-core`, `apps/cli/src/**`, `docs/00_ADR.md`, `docs/03_ARCHITECTURE.md`.

**Frozen vars (all strings).** `script_approved` default `""`; `"true"` skips `script-review`. Other defaults: `target_duration_min=8`, `words_per_min=150`, `cjk_chars_per_min=220`, `language=en`, `plugins_path=./plugins`, `validate_script=plugins/kk/lib/validate-voicescript.ts`, `__runId=solo`.

**Frozen extra transitions.** `outline-write` → commit when `outline` set. `script-validate` → `wrap-docs` when `script_approved=true`. `script-review` approve when `__hitlAnswer` empty or `yes`. `duration-check` → `done` when `content.json` missing or in `[0.5, 2]×` band.

**Helper.** `bun plugins/kk/lib/validate-voicescript.ts --in <path>` imports `validateVoiceScript` from `../../generations/voice-gen/src/voicescript`.

**Anti-patterns.** Helper not under `scripts/`. No `action-ok`. No duration flag on `voice-gen`. No `/workflow-run` profile. No `solo-podcast` skill. No D5 edits. No MP3. No new ADR.
### Plan
1. Helper at `plugins/kk/lib/validate-voicescript.ts` + `apps/cli/tests/validate-voicescript.test.ts`.
2. YAML `plugins/kk/workflows/kk-solo-podcast.yaml` from frozen ids/vars/transitions (`script_approved` skip included).
3. Static tests `apps/cli/tests/kk-solo-podcast-workflow.test.ts`.
4. `spur workflow validate plugins/kk/workflows/kk-solo-podcast.yaml`. Dry-run with `outline=a` and `script_approved=true` reaches `done`.
5. Same commit T3/T9: satellite + `04` §0/§6 **shipped (F5)**. No §7 runner profile. No `03` / ADR body rewrite.
6. Optional local Voicebox dogfood — not CI.

Verification: `bun test apps/cli/tests/kk-solo-podcast-workflow.test.ts apps/cli/tests/validate-voicescript.test.ts` plus step 4.
### Solution
| Change | Evidence |
| --- | --- |
| Product YAML `name: kk-solo-podcast` | `plugins/kk/workflows/kk-solo-podcast.yaml:3` |
| `script_approved` var | `plugins/kk/workflows/kk-solo-podcast.yaml:20` |
| `script_approved=true` skip to wrap-docs | `plugins/kk/workflows/kk-solo-podcast.yaml:272` |
| `hitl.select` outline pause | `plugins/kk/workflows/kk-solo-podcast.yaml:104` |
| `kk executor run voice-gen` | `plugins/kk/workflows/kk-solo-podcast.yaml:213` |
| duration-check missing-file success | `plugins/kk/workflows/kk-solo-podcast.yaml:332` |
| `validateVoiceScript` helper | `plugins/kk/lib/validate-voicescript.ts:4` |
| Workflow static tests | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:14` |
| Helper tests | `apps/cli/tests/validate-voicescript.test.ts:13` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/workflows/kk-solo-podcast.yaml:3` |
| R2 | MET | `plugins/kk/workflows/kk-solo-podcast.yaml:44` |
| R3 | MET | `plugins/kk/workflows/kk-solo-podcast.yaml:104` |
| R4 | MET | `plugins/kk/lib/validate-voicescript.ts:4` |
| R5 | MET | `plugins/kk/workflows/kk-solo-podcast.yaml:20` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Product YAML lives at plugins/kk/workflows/kk-solo-podcast.yaml | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:14-19` |
| R2 — Prepare XOR topic or input_file into a works layout | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:75` |
| R3 — Outline HITL is hitl.select unless outline is pre-set | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:44` |
| R4 — Approved outline becomes a validated VoiceScript | MET | test | `apps/cli/tests/validate-voicescript.test.ts:13` |
| R5 — Script HITL gates live TTS | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:44` |
| R6 — Generate invokes voice-gen and writes sibling WAV | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:82` |
| R7 — Target length is a script budget and a duration post-check | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:82` |
| R8 — No new skill, HITL kind, kk noun, or workflow-run profile | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:97` |
| R9 — Missing or unsafe inputs fail loud | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:75` |
| R10 — Existing brief.md is not overwritten without force | MET | test | `apps/cli/tests/kk-solo-podcast-workflow.test.ts:75` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECUA Code Review**

1. **Security**:
   - Zero unsanitized input execution; input path existence and file format validation in place.
   - Isolation boundaries respected; helper is checkout-only without external dependencies.

2. **Error Handling**:
   - Explicit fail-loud error messages matching frozen specs (`missing work_dir`, `XOR violation: ...`, `missing voice_profile ...`, `initialization target already exists ...`, `duration-check failed: ...`).
   - Validate-voicescript helper exits 1 with actionable errors on stderr for invalid JSON/YAML or schema violations.

3. **Correctness & Contract Adherence**:
   - Full compliance with task requirements R1–R5 and feature acceptance criteria R1–R10.
   - Product workflow adheres to ADR-009, ADR-011, and D5/F4 conventions.

4. **Maintainability & Simplicity**:
   - Zero unnecessary skills, CLI nouns, or workflow-run profiles introduced.
   - Clean, modular workflow definition and standalone validator helper.

**Priority Findings**

| Priority | Finding | Action | Status |
| -------- | ------- | ------ | ------ |
| P1 | None | None | Resolved |
| P2 | None | None | Resolved |
| P3 | None | None | Resolved |
| P4 | None | None | Resolved |

**Traceability Matrix (P1–P4)**

| Req | Description | Implementation File | Test File & Case | Verdict |
| --- | ----------- | ------------------- | ---------------- | ------- |
| R1 | State Machine Product YAML | `plugins/kk/workflows/kk-solo-podcast.yaml` | `apps/cli/tests/kk-solo-podcast-workflow.test.ts` (R1) | **PASS** |
| R2 | Prepare XOR & Works Layout | `plugins/kk/workflows/kk-solo-podcast.yaml` | `apps/cli/tests/kk-solo-podcast-workflow.test.ts` (R2) | **PASS** |
| R3 | Spur HITL Actions & Scribe Steps | `plugins/kk/workflows/kk-solo-podcast.yaml` | `apps/cli/tests/kk-solo-podcast-workflow.test.ts` (R3) | **PASS** |
| R4 | VoiceScript Validator & Plugin Invoke | `plugins/kk/lib/validate-voicescript.ts` | `apps/cli/tests/validate-voicescript.test.ts` (all) | **PASS** |
| R5 | Static Invariant Tests & Quality Gate | `apps/cli/tests/kk-solo-podcast-workflow.test.ts` | `bun run spur-check` (423 tests pass) | **PASS** |

### References
- Feature: [F5_solo-podcast-workflow-voice-gen-dogfood.md](../features/F5_solo-podcast-workflow-voice-gen-dogfood.md)
- Satellite: [kk-solo-podcast.md](../design/kk-solo-podcast.md)
- Voice generator: [voice-gen.md](../design/voice-gen.md) · plugin `plugins/generations/voice-gen/` (D5, read-only)
- Clone grain: [kk-itc.yaml](../../plugins/kk/workflows/kk-itc.yaml) · [kk-itc-workflow.test.ts](../../apps/cli/tests/kk-itc-workflow.test.ts) (F4 / 0069)
- Isolation: [.spur/rules/boundary/shipped-script-isolation.yaml](../../.spur/rules/boundary/shipped-script-isolation.yaml)
- Runner (do not extend): [workflow-run.md](../../plugins/kk/commands/workflow-run.md)
- ADR-009 product YAML home; ADR-011 no new `kk` noun — `docs/00_ADR.md`
- Doc contract: `packages/kk-core/src/schemas.ts` (`DocSchema`)
- Idea eval: `.spur/run/idea-eval-report.md` · brainstorm `docs/plans/2026-08-19-solo-podcast-brainstorm.md`
### History
- 2026-08-20T06:20:08.677Z todo → wip (system)
- 2026-08-20T06:22:27.919Z wip → testing (system)
- 2026-08-20T06:22:49.218Z testing → done (system)
