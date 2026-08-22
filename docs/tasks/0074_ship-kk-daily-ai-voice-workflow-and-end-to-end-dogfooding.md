---
schema_version: 1
name: "Ship kk-daily-ai-voice workflow and end-to-end dogfooding"
status: done
template: feature-impl
created_at: 2026-08-22T04:16:03.600Z
updated_at: "2026-08-22T05:38:48.157Z"
feature_id: F6
---

## 0074. Ship kk-daily-ai-voice workflow and end-to-end dogfooding

### Background
To automate daily AI news broadcasts and dogfood the `voice-gen` plugin with a real-world multi-stage pipeline, knowledge-kit needs a dedicated product workflow `kk-daily-ai-voice` that orchestrates data fetching via `aihot-ingest`, script generation via `dailynews-gen`, and audio generation via `voice-gen`.
### Requirements
- [x] R1. Workflow lives at `plugins/kk/workflows/kk-daily-ai-voice.yaml` declaring `name: kk-daily-ai-voice` and `kind: state-machine`.
- [x] R2. Variables include `work_dir` (required), `limit` (default: "10"), `voice_profile` (default: "Robin"), `language` (default: "zh"), `title` (optional), `skip_review` (default: "false"), `transcode_mp3` (default: "false").
- [x] R3. Orchestrates state machine flow: `prepare` -> `fetch` (`aihot-ingest`) -> `script` (`dailynews-gen`) -> `review` (HITL confirm) -> `wrap-docs` -> `generate` (`voice-gen`) -> `done`.
- [x] R4. Conforms to the state-machine workflow schema with valid transitions and terminal states.
- [x] R5. Workflow integration test asserts actual command dispatch and artifact creation with an offline fake `kk` executable.
### Acceptance Criteria
```gherkin
Feature: Daily AI news workflow and plugins

  @core
  Scenario: R5 — kk-daily-ai-voice workflow chains ingestion, script generation, and voice-gen
    Given plugins/kk/workflows/kk-daily-ai-voice.yaml exists
    When the workflow runs with work_dir
    Then it executes aihot-ingest to fetch news Doc[]
    And it executes dailynews-gen to produce the broadcast VoiceScript
    And it executes voice-gen to generate the final audio WAV and optional MP3
    And the workflow passes spur workflow validate

  @edge
  Scenario: R7 — Offline test coverage and boundaries
    Given unit tests for aihot-ingest, dailynews-gen, and kk-daily-ai-voice
    When bun test runs
    Then all tests pass with zero globalThis.fetch mutations and >=90% line and function coverage
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
- Workflow YAML: `plugins/kk/workflows/kk-daily-ai-voice.yaml`
- Subdirectories in `work_dir`:
  - `1-ingest/docs.json`
  - `2-script/content.json` & `2-script/voicescript.yaml`
  - `3-audio/docs.json` & `3-audio/content.json` & `3-audio/content.wav` (and optional `content.mp3`)
- Skip-review flag: `vars.skip_review` = `"true"` transitions directly from `script` to `wrap-docs`.
### Plan
1. Author `plugins/kk/workflows/kk-daily-ai-voice.yaml`.
2. Validate with `spur workflow validate`.
3. Author workflow integration tests with mock executor responses.
4. Run full `spur-check` gate.
### Solution
- `plugins/kk/workflows/kk-daily-ai-voice.yaml:3`: `kk-daily-ai-voice` workflow name.
- `plugins/kk/workflows/kk-daily-ai-voice.yaml:4`: `state-machine` workflow kind.
- `plugins/kk/workflows/kk-daily-ai-voice.yaml:18`: `voice_profile: Robin` default.
- `plugins/kk/workflows/kk-daily-ai-voice.yaml:28`: `prepare` state; following states implement fetch/script/review/wrap/generate.
- `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:18`: state-machine structure test.
- `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:47`: actual offline workflow execution test.
- `docs/design/kk-daily-ai-voice.md:22`: workflow invocation surface.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/workflows/kk-daily-ai-voice.yaml:3` — workflow name; adjacent line declares state-machine kind |
| R2 | MET | `plugins/kk/workflows/kk-daily-ai-voice.yaml:18` — Robin voice-profile default |
| R3 | MET | `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:18` — complete ordered state-list test |
| R4 | MET | `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice.yaml --json`: valid true, zero composition findings |
| R5 | MET | Actual offline Spur execution with fake `kk`, ordered dispatch, and artifact checks at `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:47` |
| AC-5 | MET | Feature-scenario alias for R5; executable evidence below |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R5 — kk-daily-ai-voice workflow chains ingestion, script generation, and voice-gen | MET | test | Actual workflow execution and all artifact assertions at `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:47`; `spur workflow validate` valid with zero findings; dry-run `f6-verify-dry-20260821-1` reached `done` in five transitions |
| R7 — Offline test coverage and boundaries | MET | command | `bun run spur-check`: 460 tests pass, aggregate 99.38% functions / 98.26% lines; workflow integration uses only a local fake executable |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; actual offline workflow execution covers ordered dispatch and artifacts |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Workflow identity at `plugins/kk/workflows/kk-daily-ai-voice.yaml:3` |
| R2 | MET | Workflow variable surface at `plugins/kk/workflows/kk-daily-ai-voice.yaml:14` |
| R3 | MET | Ordered state-machine structure at `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:18` |
| R4 | MET | `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice.yaml --json` returns `valid: true` with zero composition findings |
| R5 | MET | Actual offline Spur execution and artifact assertions at `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:47` |
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-22T04:21:14.737Z todo → wip (system)
- 2026-08-22T04:22:10.971Z wip → testing (system)
- 2026-08-22T04:22:11.253Z testing → done (system)
