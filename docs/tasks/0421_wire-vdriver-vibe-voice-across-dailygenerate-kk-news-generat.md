---
schema_version: 1
name: Wire vdriver vibe-voice across dailyGenerate, kk news generate-voice, board manifest and docs
status: done
template: feature-impl
created_at: 2026-11-21T07:41:11.818Z
updated_at: "2026-11-21T09:25:15.739Z"
feature_id: G16
priority: P2
estimate_hours: 3

dependencies: ["0420"]
done_forced: "false"
done_reason: unforced close
---

## 0421. Wire vdriver vibe-voice across dailyGenerate, kk news generate-voice, board manifest and docs

### Background

Implements: R2 — Daily and news workflows select VibeVoice explicitly and switch cleanly; R3 — Audio caches distinguish VibeVoice from other voice drivers.

Depends on the standalone `vibe-voice-tts` generator plugin (`kk:vibe-voice-tts`). Wires `vibe-voice` (and convenience alias `vibevoice`) into `dailyGenerate` (`plugins/kk/scripts/daily-stages.ts:1377`), its single-worker batch section loop (`plugins/kk/scripts/daily-stages.ts:1729`), speaking-rate helpers (`plugins/kk/scripts/daily-stages.ts:4677`), `kk news generate-voice --engine` (`apps/cli/src/commands/content-generate.ts:73`), and the Spur Board settings allowlist (`apps/cli/src/board/manifest.ts:56`), plus `docs/03_ARCHITECTURE.md` and `docs/04_DESIGN.md` surface sync.

Rubric: E3 D1 L2 C1 R1 = 8 → decompose (depends on standalone `vibe-voice-tts` plugin and owns CLI/stage/board/doc surfaces).

### Requirements

- [x] R1. Register `'vibe-voice': 'vibe-voice-tts'` and `'vibevoice': 'vibe-voice-tts'` in `dailyGenerate`'s `VOICE_DRIVERS` (`plugins/kk/scripts/daily-stages.ts`), generalize the single-worker batch section branch to support both `voxcpm-tts` (`VOXCPM_BATCH_MANIFEST`) and `vibe-voice-tts` (`VIBEVOICE_BATCH_MANIFEST`), and add `vibe-voice`/`vibevoice` rate `5.2` to `spokenCharRate` (`plugins/kk/scripts/daily-stages.ts`).
- [x] R2. Add `'vibe-voice'` to `VOICE_ENGINES` and `ENGINE_DRIVERS` in `apps/cli/src/commands/content-generate.ts` and add `'vibe-voice'` and `'vibevoice'` to `FAMILY_SETTINGS['kk-daily-ai-voice2'].vdriver.values` in `apps/cli/src/board/manifest.ts`.
- [x] R3. Verify driver-aware whole-document and section audio cache isolation when switching between `vibe-voice` and other drivers (`voxcpm`, `gemini`, `ominivoice`, `voicebox`) in `apps/cli/tests/daily-generate-sections.test.ts`, `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts`, and `apps/cli/tests/content-generate.test.ts` (or board manifest tests).
- [x] R4. Sync `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, and workflow comments (`plugins/kk/workflows/kk-daily-ai-voice.yaml`, `plugins/kk/workflows/kk-daily-ai-voice2.yaml`) with the `vibe-voice` driver surface.

### Acceptance Criteria

- [x] AC1 — Daily and news workflows select VibeVoice explicitly and switch cleanly
- [x] AC2 — Audio caches distinguish VibeVoice from other voice drivers

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

#### Architectural Alignment
- **VibeVoice driver wiring (`vibe-voice` / `vibevoice` -> `vibe-voice-tts`):** Added explicit opt-in driver selection across daily stage routing, CLI engine mapping, board manifest schema, and workflow parameter documentation without altering default drivers (`gemini` in `kk-daily-ai-voice`, `voxcpm` in `kk-daily-ai-voice2` / `content generate`) or existing fallback behavior.
- **Generalized batch manifest & cache isolation:** Replaced hardcoded VoxCPM-only batch manifest branching with data-driven `BATCH_MANIFEST_CONFIG` mapping `voxcpm-tts` (`VOXCPM_BATCH_MANIFEST` / `.voxcpm_batch.json`) and `vibe-voice-tts` (`VIBEVOICE_BATCH_MANIFEST` / `.vibe-voice_batch.json`). Cache keys and artifacts remain isolated per driver (`vdriver`).
- **Spoken char rate parity:** Extended `spokenCharRate` (`5.2`) in `daily-stages.ts` to include `vibe-voice` and `vibevoice`.

#### Change Map
- `plugins/kk/scripts/daily-stages.ts`: lines `1377-1384` (`VOICE_DRIVERS`), lines `1731-1790` (`BATCH_MANIFEST_CONFIG` loop), line `4702` (`spokenCharRate`).
- `apps/cli/src/commands/content-generate.ts`: line `73` (`VOICE_ENGINES`), line `86` (`ENGINE_DRIVERS['vibe-voice']`).
- `apps/cli/src/board/manifest.ts`: line `56` (`FAMILY_SETTINGS['kk-daily-ai-voice2'].vdriver.values`).
- `plugins/kk/workflows/kk-daily-ai-voice.yaml`: lines `24-27`, `409` (`vdriver` parameter documentation).
- `plugins/kk/workflows/kk-daily-ai-voice2.yaml`: lines `27-30` (`vdriver` parameter documentation).
- `docs/03_ARCHITECTURE.md`: lines `54-61`, `84`, `471` (`vibe-voice-tts` plugin registration and architecture inventory).
- `docs/04_DESIGN.md`: lines `60`, `1460`, `1630`, `1634`, `1655-1672` (`vdriver` / `--engine` surface documentation).
- `docs/00_ADR.md`: line `2054` (ADR status updated to `Accepted (implemented — G16)`).
- `docs/design/vibe-voice-driver.md`: lines `13`, `59` (design status and driver alignment).
- `apps/cli/tests/daily-generate-sections.test.ts`: lines `54-55`, `74`, `742-830` (whole-doc/sectioned `vibe-voice`/`vibevoice` selection, `VIBEVOICE_BATCH_MANIFEST`, cache isolation).
- `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts`: lines `549`, `568-575`, `715`, `832-869`, `906`.
- `apps/cli/tests/content-generate.e2e.test.ts`: lines `652-674` (`--engine vibe-voice` & default `voxcpm`).
- `apps/cli/tests/board/manifest.test.ts`: lines `42-50`.
- `apps/cli/tests/kk-workflow-stages.test.ts`: lines `4728-4750` (`spokenCharRate` across drivers).

#### Verification
- `bun run format && bun run build && bun run lint`: 0 errors (969 files formatted/checked, 45 workspace typechecks passed).
- `bun run test-pre-check`: 60/60 rules passed; `bun run test-post-check`: 3/3 rules passed.
- `apps`, `packages`, `plugins/generations/vibe-voice-tts`: 2709 pass, 0 fail (187 files); `apps/cli/tests/kk-workflow-stages.test.ts`: 173 pass, 0 fail.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/scripts/daily-stages.ts:1377-1384`, `plugins/kk/scripts/daily-stages.ts:4702`, `plugins/kk/workflows/kk-daily-ai-voice.yaml:24-27`, `plugins/kk/workflows/kk-daily-ai-voice.yaml:409`, `plugins/kk/workflows/kk-daily-ai-voice2.yaml:27-30`, `apps/cli/tests/kk-workflow-stages.test.ts:4728-4750` |
| R2 | MET | `apps/cli/src/commands/content-generate.ts:73`, `apps/cli/src/commands/content-generate.ts:86`, `apps/cli/src/board/manifest.ts:56`, `apps/cli/tests/content-generate.e2e.test.ts:652-674`, `apps/cli/tests/board/manifest.test.ts:42-50` |
| R3 | MET | `plugins/kk/scripts/daily-stages.ts:1731-1790`, `apps/cli/tests/daily-generate-sections.test.ts:54-55`, `apps/cli/tests/daily-generate-sections.test.ts:74`, `apps/cli/tests/daily-generate-sections.test.ts:742-830`, `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:832-869` |
| R4 | MET | `docs/03_ARCHITECTURE.md:54-61`, `docs/03_ARCHITECTURE.md:84`, `docs/03_ARCHITECTURE.md:471`, `docs/04_DESIGN.md:60`, `docs/04_DESIGN.md:1460`, `docs/04_DESIGN.md:1630`, `docs/04_DESIGN.md:1634`, `docs/04_DESIGN.md:1655-1672`, `docs/00_ADR.md:2054`, `docs/design/vibe-voice-driver.md:13`, `docs/design/vibe-voice-driver.md:59` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Daily and news workflows select VibeVoice explicitly and switch cleanly | MET | test | `plugins/kk/scripts/daily-stages.ts:1377-1384`, `apps/cli/src/commands/content-generate.ts:73`, `apps/cli/src/commands/content-generate.ts:86`, `apps/cli/src/board/manifest.ts:56`, `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:549`, `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:568-575`, `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:832-869`, `apps/cli/tests/content-generate.e2e.test.ts:652-674`, `apps/cli/tests/board/manifest.test.ts:42-50`, `apps/cli/tests/kk-workflow-stages.test.ts:4728-4750` (173 pass, 0 fail; full apps+packages+vibe-voice-tts 2709 pass, 0 fail; light-gate 325 pass, 0 fail; `bun run lint` 0 errors) |
| AC2 — Audio caches distinguish VibeVoice from other voice drivers | MET | test | `plugins/kk/scripts/daily-stages.ts:1731-1790`, `apps/cli/tests/daily-generate-sections.test.ts:54-55`, `apps/cli/tests/daily-generate-sections.test.ts:74`, `apps/cli/tests/daily-generate-sections.test.ts:742-830` (VIBEVOICE_BATCH_MANIFEST / `.vibe-voice_batch.json` + whole-doc & sectioned cache key isolation verified across drivers) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature: `docs/features/G16_vibevoice-voice-driver-vibe-voice-for-tts-workflows.md`
- ADR: `docs/00_ADR.md` (ADR-055)
- Design satellite: `docs/design/vibe-voice-driver.md`
- Upstream dependency: task `0420` (`plugins/generations/vibe-voice-tts`)
- Target files: `plugins/kk/scripts/daily-stages.ts:1377`, `apps/cli/src/commands/content-generate.ts:73`, `apps/cli/src/board/manifest.ts:56`

### History

- 2026-11-21T09:22:06.451Z todo → wip (system)
- 2026-11-21T09:25:13.825Z wip → testing (system)
- 2026-11-21T09:25:15.731Z testing → done (system)

