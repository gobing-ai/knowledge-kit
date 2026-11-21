---
schema_version: 1
name: Wire vdriver vibe-voice across dailyGenerate, kk news generate-voice, board manifest and docs
status: todo
template: feature-impl
created_at: 2026-11-21T07:41:11.818Z
updated_at: "2026-11-21T07:43:32.083Z"
feature_id: G16
priority: P2
estimate_hours: 3

dependencies: ["0420"]
---

## 0421. Wire vdriver vibe-voice across dailyGenerate, kk news generate-voice, board manifest and docs

### Background

Implements: R2 — Daily and news workflows select VibeVoice explicitly and switch cleanly; R3 — Audio caches distinguish VibeVoice from other voice drivers.

Depends on the standalone `vibe-voice-tts` generator plugin (`kk:vibe-voice-tts`). Wires `vibe-voice` (and convenience alias `vibevoice`) into `dailyGenerate` (`plugins/kk/scripts/daily-stages.ts:1377`), its single-worker batch section loop (`plugins/kk/scripts/daily-stages.ts:1729`), speaking-rate helpers (`plugins/kk/scripts/daily-stages.ts:4677`), `kk news generate-voice --engine` (`apps/cli/src/commands/content-generate.ts:73`), and the Spur Board settings allowlist (`apps/cli/src/board/manifest.ts:56`), plus `docs/03_ARCHITECTURE.md` and `docs/04_DESIGN.md` surface sync.

Rubric: E3 D1 L2 C1 R1 = 8 → decompose (depends on standalone `vibe-voice-tts` plugin and owns CLI/stage/board/doc surfaces).

### Requirements

- [ ] R1. Register `'vibe-voice': 'vibe-voice-tts'` and `'vibevoice': 'vibe-voice-tts'` in `dailyGenerate`'s `VOICE_DRIVERS` (`plugins/kk/scripts/daily-stages.ts`), generalize the single-worker batch section branch to support both `voxcpm-tts` (`VOXCPM_BATCH_MANIFEST`) and `vibe-voice-tts` (`VIBEVOICE_BATCH_MANIFEST`), and add `vibe-voice`/`vibevoice` rate `5.2` to `spokenCharRate` (`plugins/kk/scripts/daily-stages.ts`).
- [ ] R2. Add `'vibe-voice'` to `VOICE_ENGINES` and `ENGINE_DRIVERS` in `apps/cli/src/commands/content-generate.ts` and add `'vibe-voice'` and `'vibevoice'` to `FAMILY_SETTINGS['kk-daily-ai-voice2'].vdriver.values` in `apps/cli/src/board/manifest.ts`.
- [ ] R3. Verify driver-aware whole-document and section audio cache isolation when switching between `vibe-voice` and other drivers (`voxcpm`, `gemini`, `ominivoice`, `voicebox`) in `apps/cli/tests/daily-generate-sections.test.ts`, `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts`, and `apps/cli/tests/content-generate.test.ts` (or board manifest tests).
- [ ] R4. Sync `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, and workflow comments (`plugins/kk/workflows/kk-daily-ai-voice.yaml`, `plugins/kk/workflows/kk-daily-ai-voice2.yaml`) with the `vibe-voice` driver surface.

### Acceptance Criteria

- [ ] AC1 — Daily and news workflows select VibeVoice explicitly and switch cleanly
- [ ] AC2 — Audio caches distinguish VibeVoice from other voice drivers

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-21T07:42:37.114Z

- CLOSED: Registers both `vibe-voice` and convenience alias `vibevoice` in `dailyGenerate`'s `VOICE_DRIVERS` (`plugins/kk/scripts/daily-stages.ts:1377`) and `FAMILY_SETTINGS['kk-daily-ai-voice2'].vdriver.values` (`apps/cli/src/board/manifest.ts:56`), and `'vibe-voice'` in `VOICE_ENGINES` / `ENGINE_DRIVERS` (`apps/cli/src/commands/content-generate.ts:73`).
- CLOSED: Generalizes the single-worker batch section synthesis branch in `dailyGenerate` (`plugins/kk/scripts/daily-stages.ts:1729`) to pass `VIBEVOICE_BATCH_MANIFEST` for `vibe-voice-tts` alongside `VOXCPM_BATCH_MANIFEST` for `voxcpm-tts`.
- CLOSED: Leaves existing workflow defaults (`voxcpm` for `kk-news-generate`/`kk-daily-ai-voice2`, `gemini` for `kk-daily-ai-voice`) and fallback chains unchanged.

### Design

Approach: Extend the existing voice-driver dispatch tables and batch-manifest helper without changing default drivers or fallback chains (`ADR-055`, `docs/design/vibe-voice-driver.md`).
- Frozen mappings: `VOICE_DRIVERS['vibe-voice'] = 'vibe-voice-tts'`, `VOICE_DRIVERS.vibevoice = 'vibe-voice-tts'`; `VOICE_ENGINES` includes `'vibe-voice'`; `ENGINE_DRIVERS['vibe-voice'] = 'vibe-voice'`; batch manifest env key map `{ 'voxcpm-tts': 'VOXCPM_BATCH_MANIFEST', 'vibe-voice-tts': 'VIBEVOICE_BATCH_MANIFEST' }` with temp manifest `.vibe-voice_batch.json` (or `.voxcpm_batch.json`).
- Cache isolation: `wholeDocCache` checks `metadata.generator === 'kk:vibe-voice-tts'` and section hashes fold in `voiceGenerator` (`sha256(text + '\0' + voiceProfile + '\0' + driver)`), ensuring switching in and out between `vibe-voice` and other drivers never reuses foreign audio.
- Anti-patterns: do not change `NEWS_STAGE_DEFAULTS.vdriver` (`voxcpm`) or `kk-daily-ai-voice.yaml` default (`gemini`); do not probe Gemini when `vdriver` is `vibe-voice`.
- Primary file targets: `plugins/kk/scripts/daily-stages.ts`, `apps/cli/src/commands/content-generate.ts`, `apps/cli/src/board/manifest.ts`, `apps/cli/tests/daily-generate-sections.test.ts`, `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`.

### Plan

1. Update `plugins/kk/scripts/daily-stages.ts` (`VOICE_DRIVERS`, batch manifest synthesis branch, `spokenCharRate`).
2. Update `apps/cli/src/commands/content-generate.ts` (`VOICE_ENGINES`, `ENGINE_DRIVERS`) and `apps/cli/src/board/manifest.ts` (`vdriver` choices).
3. Add whole-document, batch-section, and cross-driver cache-switching tests in `apps/cli/tests/daily-generate-sections.test.ts` and `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts`.
4. Sync `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, and workflow YAML comments, then run full verification gates.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/G16_vibevoice-voice-driver-vibe-voice-for-tts-workflows.md`
- ADR: `docs/00_ADR.md` (ADR-055)
- Design satellite: `docs/design/vibe-voice-driver.md`
- Upstream dependency: task `0420` (`plugins/generations/vibe-voice-tts`)
- Target files: `plugins/kk/scripts/daily-stages.ts:1377`, `apps/cli/src/commands/content-generate.ts:73`, `apps/cli/src/board/manifest.ts:56`

### History
