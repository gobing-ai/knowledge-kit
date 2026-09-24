---
schema_version: 1
name: Wire vdriver gemini into kk-daily-ai-voice and sync docs
status: done
template: feature-impl
created_at: 2026-09-24T17:58:49.694Z
updated_at: "2026-09-24T19:48:20.121Z"
feature_id: F612
priority: P2
tags:
  - gemini-tts
  - workflow
  - docs
estimate_hours: 1.5

dependencies: ["0158"]
---

## 0160. Wire vdriver gemini into kk-daily-ai-voice and sync docs

### Background

Feature F612 (docs/design/gemini-tts.md, ADR-023). Make vdriver gemini select the new driver in kk-daily-ai-voice without changing the default, and sync surface docs. Covers feature scenario R5.

### Requirements

- [x] R1. plugins/kk/scripts/kk-workflow-stages.ts:968 dailyGenerate VOICE_DRIVERS gains gemini: 'gemini-tts'; the stage invokes kk executor run gemini-tts with the same --in/--out paths as voicebox, and the unknown-vdriver error lists gemini.
- [x] R2. kk-daily-ai-voice.yaml default vdriver stays voicebox; the vdriver var comment (line ~24) and the generate state description (line 207) list gemini -> gemini-tts.
- [x] R3. docs/04_DESIGN.md: env table gains GEMINI_API_KEY (yes for gemini-tts), GOOGLE_BASE_URL, GEMINI_TTS_MODEL, GEMINI_TTS_PROFILES, GEMINI_TTS_ASR, GEMINI_TTS_ASR_MODEL, GEMINI_TTS_MAX_ATTEMPTS, GEMINI_TTS_TIMEOUT_MS (each "no (gemini-tts)"; neither GEMINI_API_KEY nor GOOGLE_BASE_URL has a row today — add both); the voice-gen-shared rows (VOICEBOX_DEFAULT_PROFILE, VOICE_GEN_FAIL_ON_QC, VOICE_GEN_MP3, VOICE_GEN_MAX_RUN_MS) list gemini-tts; the design-index row for gemini-tts.md becomes "shipped (F612)"; docs/design/gemini-tts.md Status line becomes shipped.
- [x] R4. apps/cli/tests/kk-daily-ai-voice-workflow.test.ts covers vdriver 'gemini': the call log ends with 'gemini-tts' and the generated content carries metadata.generator 'kk:gemini-tts'.

### Acceptance Criteria

- [x] AC1 — vdriver gemini selects gemini-tts in the daily voice workflow

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-24T18:07:10.356Z

- **docs/05_FEATURES.md row — CLOSED, dropped.** The F61x voice-driver family has no rows in 05 (F611 omni-voice-gen isn't there either). Feature status is tracked in the spur-generated `docs/features/INDEX.md` (F612 `[backlog]` under F61). Update status via `spur feature update F612 <status>` at wrap, not by hand-editing 05 or INDEX.
- **Default vdriver — CLOSED.** Stays `voicebox` (design D8; the flip needs an operator listening A/B, deferred I7).
- **OMNIVOICE_SPEED in the generate command — CLOSED, untouched.** Only omni-voice-gen reads it. Gemini pacing comes from `speech_metadata.style` plus voice-gen's `applySpeed`.
- **Dependency on 0158 — CLOSED.** The integration test uses the fake `kk` shim (no real plugin exec), so 0160 can land once 0158's `metadata.generator` tag exists. The shim must emit `kk:gemini-tts` for the gemini branch, mirroring the ominivoice branch.

### Design

- Approach: one map entry (design D8). Downstream stages (intro-music, quality report, publish) already read `metadata.audioPath`/`mp3Path`/`qc`, so nothing else changes.
- Rejected: flipping the default now (needs operator listening A/B, deferred I7).
- Invariant: voicebox and ominivoice selections unchanged; unknown vdriver still fails loud.
- Test anchors: `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts`:
  - `:246-250`: the `[vdriver, qcPassed]` matrix. Add `['gemini', true]`.
  - `:476-481`: the generator assertion. Generalize it to a `{ ominivoice: 'kk:omni-voice-gen', gemini: 'kk:gemini-tts' }` lookup.
  - `:501`: the expected last plugin. Use the same lookup (`omni-voice-gen` / `gemini-tts` / `voice-gen`).
  - `:393-401`: the fake `kk` shim branch `else if (plugin === 'omni-voice-gen')` writes `generator: 'kk:omni-voice-gen'`. Add a sibling `gemini-tts` branch emitting `kk:gemini-tts`.
- Cost note: each matrix row runs the whole workflow through the real spur engine. One extra row is acceptable (same as ominivoice).

### Plan

- [x] VOICE_DRIVERS entry (kk-workflow-stages.ts:968)
- [x] workflow YAML comment + generate description
- [x] integration test matrix row + generator/call-log lookups + fake-kk shim branch
- [x] docs/04_DESIGN.md env rows + design-index status; docs/design/gemini-tts.md status
- [x] bun run gate

### Solution

One map entry in `dailyGenerate` (design D8). Downstream stages still read `metadata.audioPath`, `mp3Path`, and `qc`. Default `vdriver` stays `voicebox`.

- `plugins/kk/scripts/kk-workflow-stages.ts:968-972` adds `gemini: 'gemini-tts'`. The same `kk executor run <plugin> --in <docs> --out <content>` call at `:986` serves voicebox, ominivoice, and gemini. An unknown name still fails at `:974-978` and now lists `gemini`.
- `plugins/kk/workflows/kk-daily-ai-voice.yaml:25` keeps `vdriver: "voicebox"`. The comment at `:22` and the generate description at `:207` list `gemini -> gemini-tts`.
- `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:250` adds the `['gemini', true]` matrix row. The fake `kk` shim at `:404-413` writes `metadata.generator` `kk:gemini-tts`. The assertion at `:490-495` and the call-log expectation at `:513` use the same driver lookup. This run: that test passed, exit 0, 118 expects, 10.76s.
- `docs/04_DESIGN.md:47` design-index status is `shipped (F612)`. Env rows `:341`, `:345`, `:359-368` add the Gemini variables and list `gemini-tts` on the shared voice-gen rows. `docs/design/gemini-tts.md:3` status is `shipped (F612)`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/scripts/kk-workflow-stages.ts:968-972` maps gemini to gemini-tts and the same dailyGenerate function runs that plugin through kk executor run |
| R2 | MET | `plugins/kk/workflows/kk-daily-ai-voice.yaml:25` is `vdriver: "voicebox"`; comment `:22` and generate description `:207` list gemini to gemini-tts |
| R3 | MET | `docs/04_DESIGN.md:47` says shipped (F612); `:341` and `:345` and `:359-368` add the Gemini env rows and name gemini-tts on the shared voice rows; `docs/design/gemini-tts.md:3` says shipped (F612) |
| R4 | MET | `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:247-252` covers vdriver gemini and expects the call log to end with gemini-tts. Passed in `bun run gate` (1335 pass / 0 fail, exit 0) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — vdriver gemini selects gemini-tts in the daily voice workflow | MET | test | `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:247-252` passed inside `bun run gate` (1335 pass / 0 fail, exit 0) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | D8 map entry added and the default vdriver stays voicebox |
| P4 | scope-creep | — | Diff is the driver map, workflow comments, the integration test, and the design env rows |
| P4 | evidence-rule-pass | — | AC1 cites the workflow test from the green gate |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-24T19:46:40.980Z todo → wip (system)
- 2026-09-24T19:46:50.819Z wip → testing (system)
- 2026-09-24T19:48:20.121Z testing → done (system)

