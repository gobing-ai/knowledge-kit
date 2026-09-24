---
schema_version: 1
name: Wire vdriver gemini into kk-daily-ai-voice and sync docs
status: todo
template: feature-impl
created_at: 2026-09-24T17:58:49.694Z
updated_at: "2026-09-24T18:07:21.153Z"
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

- [ ] R1. plugins/kk/scripts/kk-workflow-stages.ts:968 dailyGenerate VOICE_DRIVERS gains gemini: 'gemini-tts'; the stage invokes kk executor run gemini-tts with the same --in/--out paths as voicebox, and the unknown-vdriver error lists gemini.
- [ ] R2. kk-daily-ai-voice.yaml default vdriver stays voicebox; the vdriver var comment (line ~24) and the generate state description (line 207) list gemini -> gemini-tts.
- [ ] R3. docs/04_DESIGN.md: env table gains GEMINI_API_KEY (yes for gemini-tts), GOOGLE_BASE_URL, GEMINI_TTS_MODEL, GEMINI_TTS_PROFILES, GEMINI_TTS_ASR, GEMINI_TTS_ASR_MODEL, GEMINI_TTS_MAX_ATTEMPTS, GEMINI_TTS_TIMEOUT_MS (each "no (gemini-tts)"; neither GEMINI_API_KEY nor GOOGLE_BASE_URL has a row today — add both); the voice-gen-shared rows (VOICEBOX_DEFAULT_PROFILE, VOICE_GEN_FAIL_ON_QC, VOICE_GEN_MP3, VOICE_GEN_MAX_RUN_MS) list gemini-tts; the design-index row for gemini-tts.md becomes "shipped (F612)"; docs/design/gemini-tts.md Status line becomes shipped.
- [ ] R4. apps/cli/tests/kk-daily-ai-voice-workflow.test.ts covers vdriver 'gemini': the call log ends with 'gemini-tts' and the generated content carries metadata.generator 'kk:gemini-tts'.

### Acceptance Criteria

- [ ] AC1 — vdriver gemini selects gemini-tts in the daily voice workflow

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

- [ ] VOICE_DRIVERS entry (kk-workflow-stages.ts:968)
- [ ] workflow YAML comment + generate description
- [ ] integration test matrix row + generator/call-log lookups + fake-kk shim branch
- [ ] docs/04_DESIGN.md env rows + design-index status; docs/design/gemini-tts.md status
- [ ] bun run gate

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
