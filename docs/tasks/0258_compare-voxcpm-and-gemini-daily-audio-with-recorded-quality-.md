---
schema_version: 1
name: Compare VoxCPM and Gemini daily audio with recorded quality evidence
status: todo
template: feature-impl
created_at: 2026-10-12T00:07:13.361Z
updated_at: "2026-10-12T00:07:41.686Z"
feature_id: G14
priority: P2
estimate_hours: 3

dependencies: ["0257"]
---

## 0258. Compare VoxCPM and Gemini daily audio with recorded quality evidence

### Background

The purpose of G14 is to learn whether VoxCPM improves daily audio, not to assume it. The workflows use robin-news (plugins/kk/workflows/kk-daily-ai-voice.yaml:23 and kk-daily-ai-voice2.yaml:24). The current voice2 estimate is based on other drivers (plugins/kk/scripts/daily-stages.ts:638); real VoxCPM duration/startup and hardware viability require a live render. Depends on generator and workflow integration.

### Requirements

- [ ] R1. Use identical fixed Chinese and mixed Chinese-English VoiceScripts plus a representative existing daily episode in isolated VoxCPM/Gemini render-only work directories; exercise both stage invocation shapes without collection or publication.
- [ ] R2. Record text hash, model/package revision, profile/seed/settings, hardware/device, elapsed time, audio duration, artifact paths and QC limitations; measure per-invocation startup and section throughput.
- [ ] R3. Record pronunciation, completeness, timbre, prosody, pauses and artifact observations only after actual listening, or mark listening pending. Conclude better/comparable/worse/inconclusive with reasons; do not change defaults.
- [ ] R4. Persist reproducible commands and a dated comparison report with local artifact pointers. Record blockers honestly when live inference is unavailable; never substitute fake output for quality evidence. Update calibration only if measured evidence supports it.

### Acceptance Criteria

- [ ] AC1 — Matched audio comparison records quality and operating cost

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

ADR-036 and docs/design/voxcpm-daily-voice-driver.md are the decided design. vendors/ is reference-only: no product imports, path dependencies, subprocess paths, model/reference defaults, symlinks, copied modules or build inputs may resolve there. No default driver change, publishing, daemon, training or speculative abstraction. Use existing Bun/TypeScript/Biome and private uv worker; no .github/workflows changes.

Own a small fixed VoiceScript fixture under the new plugin tests/fixtures and a dated docs/plans/2026-10-11-voxcpm-audio-comparison.md report (use execution date if later); reuse kk executor/stage commands, no benchmark app. Keep generated audio/model files outside tracked source. Matched text/segments is required; different voice mechanisms/settings are disclosed. No model install from vendors and no use of vendor sample/reference audio. Defaults remain unchanged regardless of outcome. If no audio playback is available mark listening pending; if inference cannot complete, report incomplete evidence rather than task verification PASS.

Execution budget: first a short Chinese and mixed-language render pair, then one representative episode per driver; use bounded worker/executor deadlines and stop expensive retries after one environment diagnosis. Preserve versions, commands and partial artifacts under .spur/run/<run-id>/voxcpm-comparison/. requireDiff: fixtures/report, optional evidence-backed calibration and its test/docs; a report-only result does not justify invented source edits.

### Plan

- [ ] Confirm independent pinned backend installation and hardware/device availability; save versions and commands.
- [ ] Render matched short Chinese and mixed-language samples with both drivers into isolated directories; validate playable output and QC.
- [ ] Render a representative episode through both workflow stage shapes; record times, durations, memory observations if available and failure/resume behavior.
- [ ] Listen when playback is available and document concrete findings; otherwise explicitly mark listening pending and conclusion inconclusive.
- [ ] Write a dated reproducible report with artifact pointers, limitations and recommendation; update only evidence-supported calibration and run its checks.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
